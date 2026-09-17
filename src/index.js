import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { composeReply } from './agent.js';
import { breaksPersona, needsHuman } from './bot-question.js';
import { config, loadAllowlist } from './config.js';
import { isQuietHours, rand, seenDelayMs, sleep, splitReply, typingMs } from './humanize.js';
import { ensureModel } from './llm.js';
import { showConnected, showQr } from './qr-page.js';
import { appendHistory, botState, loadHistory } from './store.js';

const log = (...args) => console.log(new Date().toLocaleTimeString('en-GB'), ...args);
const MAX_MESSAGE_AGE_S = 120;
// Don't answer messages that sat unanswered this long (quiet hours, pause): a late reply looks robotic.
const STALE_REPLY_MS = 30 * 60_000;

let sock;
const pending = new Map(); // jid -> { contact, number, messages: [], timer }
const busy = new Set(); // jids currently being replied to
const botSentIds = new Set();

const digits = (jid) => (jid ?? '').split('@')[0].split(':')[0];

function textOf(msg) {
  const m = normalizeMessageContent(msg.message);
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    ''
  ).trim();
}

/** Resolve a chat JID to a phone number, even when WhatsApp addresses it by LID. */
async function phoneNumberOf(key) {
  if (!isLidUser(key.remoteJid)) return digits(key.remoteJid);
  if (key.remoteJidAlt) return digits(key.remoteJidAlt);
  const pn = await sock.signalRepository.lidMapping.getPNForLID(key.remoteJid).catch(() => null);
  return pn ? digits(pn) : null;
}

function isSelfChat(jid) {
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => digits(jidNormalizedUser(j)));
  return me.includes(digits(jid));
}

function selfJid() {
  return jidNormalizedUser(sock.user.id);
}

// Notes go only to your own "Message yourself" chat, so they're sent even in dry-run.
async function notifyOwner(text) {
  log('[owner note]', text);
  const sent = await sock.sendMessage(selfJid(), { text: `🤖 ${text}` });
  if (sent?.key?.id) botSentIds.add(sent.key.id);
}

async function handleCommand(text) {
  const cmd = text.trim().toLowerCase();
  if (cmd === '!pause') {
    botState.setPaused(true);
    return notifyOwner('Paused. I won\'t reply to anyone until you send !resume');
  }
  if (cmd === '!resume') {
    botState.setPaused(false);
    botState.releaseAll();
    return notifyOwner('Resumed, and cleared all chat takeovers.');
  }
  if (cmd === '!status') {
    const contacts = loadAllowlist();
    return notifyOwner(
      [
        `Status: ${botState.paused ? 'PAUSED' : 'running'}${config.dryRun ? ' (dry run)' : ''}`,
        `Replies today: ${botState.repliesToday}/${config.dailyCap}`,
        `Quiet hours: ${config.quietStart}:00-${config.quietEnd}:00${isQuietHours() ? ' (now)' : ''}`,
        `Allowlist: ${contacts.map((c) => c.name || c.number).join(', ') || 'empty'}`,
      ].join('\n'),
    );
  }
  return notifyOwner(
    `${cmd === '!help' ? '' : `Unknown command "${text.trim()}". `}Commands (send them in your "Message yourself" chat): !pause, !resume, !status, !help`,
  );
}

async function sendHuman(jid, text) {
  for (const part of splitReply(text)) {
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(typingMs(part));
    const sent = await sock.sendMessage(jid, { text: part });
    if (sent?.key?.id) botSentIds.add(sent.key.id);
    await sleep(rand(600, 1800));
  }
  await sock.sendPresenceUpdate('paused', jid);
}

/** Keep the "typing..." indicator alive while the model thinks. */
function keepTyping(jid) {
  let active = true;
  (async () => {
    while (active) {
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      await sleep(8_000);
    }
  })();
  return () => {
    active = false;
  };
}

async function replyTo(jid) {
  const entry = pending.get(jid);
  if (!entry || busy.has(jid)) return;
  const { contact, number } = entry;

  if (botState.paused || botState.isTakenOver(number) || isQuietHours()) return;
  if (botState.capReached()) return log(`daily cap reached, not replying to ${contact.name || number}`);

  busy.add(jid);
  try {
    await sleep(seenDelayMs());
    const batch = (pending.get(jid)?.messages ?? []).filter((m) => Date.now() - m.receivedAt < STALE_REPLY_MS);
    pending.delete(jid);
    if (!batch.length || botState.paused || botState.isTakenOver(number)) return;

    const incoming = batch.map((m) => m.text).join('\n');
    const history = loadHistory(number);
    log(`<- ${contact.name || number}: ${incoming}`);

    // Bot questions, anger or urgency: don't answer at all, hand the chat to you.
    const humanReason = needsHuman(incoming);
    if (humanReason) {
      appendHistory(number, 'user', incoming);
      botState.takeOver(number);
      log(`   ${contact.name || number} is ${humanReason} - handing chat to you`);
      await notifyOwner(
        `⚠️ ${contact.name || number} is ${humanReason}. I did NOT reply and stepped out of that chat for ${config.takeoverMs / 60_000} min - please answer yourself.\n\nThey said: ${incoming}`,
      );
      return;
    }

    if (!config.dryRun) {
      await sock.sendPresenceUpdate('available');
      await sock.readMessages(batch.map((m) => m.key));
      await sleep(rand(1_000, 4_000));
    }

    const stopTyping = config.dryRun ? () => {} : keepTyping(jid);
    const started = Date.now();
    let reply;
    try {
      reply = await composeReply(contact, history, incoming);
    } finally {
      stopTyping();
    }
    const thinkSecs = ((Date.now() - started) / 1000).toFixed(1);
    if (reply.query) log(`   researched: "${reply.query}"`);
    log(`-> ${contact.name || number} (${thinkSecs}s): ${reply.text}${reply.escalation ? `  [ESCALATE: ${reply.escalation}]` : ''}`);

    appendHistory(number, 'user', incoming);
    if (reply.text && breaksPersona(reply.text)) {
      botState.takeOver(number);
      log('   reply talked about you in third person - not sent');
      await notifyOwner(
        `⚠️ I almost sent ${contact.name || number} a reply that didn't sound like you, so I sent nothing and stepped out of that chat.\n\nThey said: ${incoming}\n\nBlocked draft: ${reply.text}`,
      );
      return;
    }
    if (reply.text) {
      if (!config.dryRun) {
        if (botState.isTakenOver(number)) return log('   you took over this chat, discarding reply');
        await sendHuman(jid, reply.text);
        await sock.sendPresenceUpdate('unavailable');
      }
      appendHistory(number, 'assistant', reply.text);
      botState.countReply();
    }
    if (reply.escalation && !reply.text) botState.takeOver(number); // nothing sent: let you answer
    if (reply.escalation) {
      await notifyOwner(
        `${contact.name || number} needs you: ${reply.escalation}\n\nThey said: ${incoming}\n\nI replied: ${reply.text || '(nothing)'}`,
      );
    }
  } catch (err) {
    log(`reply to ${contact.name || number} failed:`, err.message);
    await notifyOwner(`Couldn't reply to ${contact.name || number}: ${err.message}`).catch(() => {});
  } finally {
    busy.delete(jid);
    // Messages that arrived while we were busy get their own turn.
    if (pending.has(jid)) schedule(jid);
  }
}

function schedule(jid) {
  const entry = pending.get(jid);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => replyTo(jid), config.burstWaitMs);
}

async function onMessage(msg, type) {
  const { key } = msg;
  const jid = key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidStatusBroadcast(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return;

  const ageS = Date.now() / 1000 - Number(msg.messageTimestamp ?? 0);
  if (ageS > MAX_MESSAGE_AGE_S) return;

  const text = textOf(msg);

  if (key.fromMe) {
    if (botSentIds.has(key.id) || type !== 'notify') return;
    if (isSelfChat(jid)) {
      if (text.startsWith('!')) await handleCommand(text);
      return;
    }
    // You typed in this chat yourself: step aside.
    const number = await phoneNumberOf(key);
    if (number) {
      botState.takeOver(number);
      pending.delete(jid);
      log(`you replied to ${number} yourself - bot pausing that chat for ${config.takeoverMs / 60_000} min`);
    }
    return;
  }

  if (type !== 'notify' || !text) return;
  const number = await phoneNumberOf(key);
  const contact = number && loadAllowlist().find((c) => c.number === number);
  if (!contact) return;

  const entry = pending.get(jid) ?? { contact, number, messages: [] };
  entry.messages.push({ key, text, receivedAt: Date.now() });
  pending.set(jid, entry);
  if (!busy.has(jid)) schedule(jid);
}

/**
 * Messages you explicitly ask the bot to send: drop a JSON file
 * { "number": "2012...", "text": "..." } into data/outbox/ and it's sent once, then deleted.
 */
const outboxDir = path.join(config.dataDir, 'outbox');
fs.mkdirSync(outboxDir, { recursive: true });
let outboxBusy = false;

async function processOutbox() {
  if (outboxBusy || !sock?.user || config.dryRun) return;
  outboxBusy = true;
  try {
    for (const file of fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'))) {
      const full = path.join(outboxDir, file);
      const { number, text } = JSON.parse(fs.readFileSync(full, 'utf8'));
      fs.unlinkSync(full); // delete first so a crash never sends twice
      const [result] = await sock.onWhatsApp(number);
      if (!result?.exists) {
        await notifyOwner(`Outbox: ${number} is not on WhatsApp, message not sent.`);
        continue;
      }
      await sendHuman(result.jid, text);
      appendHistory(number, 'assistant', text);
      log(`-> ${number} (outbox): ${text}`);
    }
  } catch (err) {
    log('outbox error:', err.message);
  } finally {
    outboxBusy = false;
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.windows('Desktop'),
    logger: pino({ level: 'warn' }),
    // Don't appear online all the time, and keep phone notifications working.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log('Scan this QR code: WhatsApp on your phone > Settings > Linked devices > Link a device');
      qrcode.generate(qr, { small: true });
      showQr(qr).catch((err) => log('could not open QR page:', err.message));
    }
    if (connection === 'open') {
      showConnected(sock.user?.id);
      log(`connected as ${sock.user?.id}${config.dryRun ? ' (DRY RUN: nothing will be sent)' : ''}`);
      log(`allowlist: ${loadAllowlist().length} contact(s)`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('Logged out from WhatsApp. Delete the auth_info folder and start again to re-link.');
        process.exit(2);
      }
      log(`connection closed (${code ?? 'unknown'}), reconnecting in 5s`);
      setTimeout(start, 5_000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      await onMessage(msg, type).catch((err) => log('message handling error:', err.message));
    }
  });
}

log(`checking Ollama model ${config.model} (first load can take ~90s)...`);
try {
  await ensureModel();
} catch (err) {
  log(err.message);
  process.exit(1);
}
log('model ready');
await start();

// Messages held back by quiet hours, a pause or the daily cap get picked up once that ends.
setInterval(processOutbox, 5_000);

// Staggered so several held-back chats don't all get answered in the same second.
setInterval(() => {
  for (const jid of pending.keys()) {
    if (!busy.has(jid)) setTimeout(() => replyTo(jid), rand(0, 4 * 60_000));
  }
}, 5 * 60_000);
