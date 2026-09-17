import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
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
import { composeReply, planQueries, researchQuery, TASK_RE } from './agent.js';
import { generateImage, IMAGE_RE, imagePrompt } from './images.js';
import { research } from './research.js';
import { ACTION_RE, confirmAction, draftAction } from './actions.js';
import {
  downloadImages,
  extractPlaces,
  findPhones,
  geocode,
  imageSearch,
  LOCATION_RE,
  mapsLink,
  MENU_RE,
  PHONE_RE,
} from './places.js';
import { breaksPersona, isUpset, needsHuman } from './bot-question.js';
import {
  composeGroupReply,
  findGroupConfig,
  getBotPersona,
  GROUP_LABEL,
  GROUP_PIC_RE,
  PERSONA_CMD_RE,
  setBotPersona,
  START_RE,
  STOP_RE,
  SUMMON_RE,
} from './groups.js';
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

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

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
  if (cmd.startsWith('!persona')) {
    const value = text.trim().slice('!persona'.length).trim();
    if (!value) return notifyOwner(`Group bot persona: ${getBotPersona() || 'default (funny, playful)'}\nChange: !persona <description>   Reset: !persona reset`);
    setBotPersona(/^(reset|default|clear)$/i.test(value) ? '' : value);
    return notifyOwner(`Group bot persona ${getBotPersona() ? `set to: ${getBotPersona()}` : 'reset to default'}`);
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

// ---- Groups: an openly labelled bot, only in groups listed in config/groups.json ----
const groupSubjects = new Map();
const groupPending = new Map(); // jid -> { group, subject, messages: [], timer }
const GROUP_BURST_MS = 20_000;
const GROUP_MIN_GAP_MS = 15_000;
const GROUP_STOP_MS = 12 * 60 * 60_000;
const lastGroupReply = new Map();

async function subjectOf(jid) {
  if (!groupSubjects.has(jid)) {
    const meta = await sock.groupMetadata(jid).catch(() => null);
    groupSubjects.set(jid, meta?.subject ?? '');
  }
  return groupSubjects.get(jid);
}

async function onGroupMessage(msg, type) {
  const { key } = msg;
  const jid = key.remoteJid;
  const ageS = Date.now() / 1000 - Number(msg.messageTimestamp ?? 0);
  if (ageS > MAX_MESSAGE_AGE_S) return;
  const text = textOf(msg);
  const subject = await subjectOf(jid);
  const group = findGroupConfig(subject);
  if (!group) return;
  const groupKey = `group-${digits(jid)}`;

  const stopKey = `${groupKey}-stop`;
  const mentionOnly = group.mode === 'mention';
  if (type !== 'notify' || !text || botSentIds.has(key.id)) return;
  const name = key.fromMe ? config.ownerName : msg.pushName || 'someone';

  if (key.fromMe && group.mode !== 'always' && !(mentionOnly && SUMMON_RE.test(text))) {
    if (mentionOnly) return appendHistory(groupKey, 'user', `${name}: ${text}`);
    botState.takeOver(groupKey);
    groupPending.delete(jid);
    log(`you wrote in ${subject} yourself - bot quiet there for ${config.takeoverMs / 60_000} min`);
    return;
  }
  log(`[${subject}] ${name}: ${text}`);

  // Only you can change the bot's personality from inside a group.
  // Only you: email / calendar requests from the group are drafted privately in your self-chat.
  if (key.fromMe && /\bbot\b/i.test(text) && ACTION_RE.test(text)) {
    await sendHuman(jid, `${GROUP_LABEL}on it Shady, sent you the draft privately to confirm 📨`);
    await handleOwnerAction(text, loadHistory(groupKey));
    return;
  }

  // Only you: "bot group pic: <description>", or send/reply to a photo with "bot group pic".
  const picCmd = key.fromMe && text.match(GROUP_PIC_RE);
  if (picCmd) {
    const picDesc = (picCmd.groups.desc ?? picCmd.groups.desc2 ?? picCmd.groups.desc3 ?? '')
      .replace(/^(a|an|the)\s+(picture|photo|image)\s+of\s+/i, '')
      .replace(/[?.!]+$/, '')
      .trim();
    try {
      const m = normalizeMessageContent(msg.message);
      const quoted = m?.extendedTextMessage?.contextInfo;
      let image;
      let what = 'your photo';
      if (m?.imageMessage) {
        image = await downloadMediaMessage(msg, 'buffer', {});
      } else if (quoted?.quotedMessage?.imageMessage) {
        const quotedMsg = { key: { remoteJid: jid, id: quoted.stanzaId, participant: quoted.participant }, message: quoted.quotedMessage };
        image = await downloadMediaMessage(quotedMsg, 'buffer', {});
      } else if (picDesc) {
        what = await imagePrompt(picDesc);
        log(`   [${subject}] generating group picture: ${what}`);
        image = await withTimeout(generateImage(what), 90_000, 'image generation took too long');
      } else {
        await sendHuman(jid, `${GROUP_LABEL}tell me what to draw ("bot group pic: matcha robot") or send a photo with "bot group pic" 📸`);
        return;
      }
      log(`   [${subject}] image ready (${Math.round(image.length / 1024)} KB), uploading as group picture...`);
      await withTimeout(sock.updateProfilePicture(jid, image), 60_000, 'WhatsApp did not confirm the picture change');
      log(`   [${subject}] group picture updated`);
      await sendHuman(jid, `${GROUP_LABEL}new group picture set 🎨 (${what})`);
    } catch (err) {
      log(`   group picture failed: ${err.message}`);
      await sendHuman(jid, `${GROUP_LABEL}I couldn't change the group picture 😭 ${/forbidden|not-authorized|403|401/i.test(err.message) ? 'only admins can do that' : 'something went wrong'}`);
    }
    return;
  }

  const personaCmd = key.fromMe && text.match(PERSONA_CMD_RE);
  if (personaCmd) {
    const value = personaCmd[1].trim();
    setBotPersona(/^(reset|default|clear)?$/i.test(value) ? '' : value);
    const now = getBotPersona();
    await sendHuman(jid, `${GROUP_LABEL}${now ? `persona loaded: ${now} ✨` : 'back to my normal self 😌'}`);
    return;
  }

  if (STOP_RE.test(text)) {
    const wasStopped = botState.isTakenOver(stopKey);
    botState.takeOver(stopKey, GROUP_STOP_MS);
    groupPending.delete(jid);
    if (!wasStopped) await sendHuman(jid, `${GROUP_LABEL}ok ok I'm leaving 😭👋 (${config.ownerName}'s bot, off for 12h - say "start bot" to bring me back)`);
    await notifyOwner(`${name} asked the bot to stop in ${subject}. It's off there for 12 hours unless someone says "start bot".`);
    return;
  }
  if (START_RE.test(text)) botState.release(stopKey);

  const called = SUMMON_RE.test(text) || START_RE.test(text);
  if (mentionOnly && !called) return appendHistory(groupKey, 'user', `${name}: ${text}`);

  const entry = groupPending.get(jid) ?? { group, subject, groupKey, stopKey, messages: [] };
  entry.messages.push({ key, name, text, receivedAt: Date.now() });
  groupPending.set(jid, entry);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => replyToGroup(jid), mentionOnly ? 4_000 : GROUP_BURST_MS);
}

/**
 * Menu photos, location pins and phone numbers for places people ask about.
 * Sends the media straight to the chat and returns notes for the text reply.
 */
async function sendPlaceInfo(jid, subject, text, history) {
  const wantsMenu = MENU_RE.test(text);
  const wantsLocation = LOCATION_RE.test(text);
  const wantsPhone = PHONE_RE.test(text);
  if (!wantsMenu && !wantsLocation && !wantsPhone) return '';

  const places = await extractPlaces(text, history);
  log(`   [${subject}] place info for: ${places.map((p) => p.name).join(', ') || 'nothing found'}`);
  const notes = [];
  for (const place of places) {
    const lines = [`Place: ${place.name} (${place.area})`, `Google Maps: ${mapsLink(place.name, place.area)}`];
    if (wantsMenu) {
      const images = await downloadImages(await imageSearch(`${place.name} menu Egypt`).catch(() => []), 2);
      for (const [i, image] of images.entries()) {
        const sent = await sock.sendMessage(jid, {
          image,
          caption: `${GROUP_LABEL}${place.name} menu ${i + 1}/${images.length} (from the web, prices may be outdated)`,
        });
        if (sent?.key?.id) botSentIds.add(sent.key.id);
      }
      lines.push(images.length ? `Sent ${images.length} menu photo(s) in the chat.` : 'No menu photos found online.');
    }
    if (wantsLocation) {
      const geo = await geocode(place.name, place.area).catch(() => null);
      if (geo) {
        const sent = await sock.sendMessage(jid, {
          location: { degreesLatitude: geo.lat, degreesLongitude: geo.lon, name: place.name, address: geo.address },
        });
        if (sent?.key?.id) botSentIds.add(sent.key.id);
        lines.push(`Sent a location pin: ${geo.address} (from OpenStreetMap, double-check on Google Maps).`);
      } else {
        lines.push('No exact pin found on OpenStreetMap; share the Google Maps link instead.');
      }
    }
    if (wantsPhone) {
      const found = await research(`${place.name} ${place.area} phone number hotline`, { pages: 2, chars: 1500 }).catch(() => '');
      const phones = findPhones(found);
      lines.push(phones.length ? `Phone numbers found online: ${phones.join(', ')}` : 'No phone number found online.');
    }
    notes.push(lines.join('\n'));
  }
  return notes.length
    ? `# Place info you just looked up (include the Google Maps links and any phone numbers exactly as written)\n${notes.join('\n\n')}`
    : '';
}

async function replyToGroup(jid) {
  const entry = groupPending.get(jid);
  if (!entry) return;
  if (busy.has(jid)) return log('   group reply skipped: still busy with previous reply');
  const { group, subject, groupKey, stopKey } = entry;
  // In mention mode someone explicitly called the bot, so your own recent posts don't silence it.
  const ownerQuiet = !['mention', 'always'].includes(group.mode) && botState.isTakenOver(groupKey);
  if (botState.paused || ownerQuiet || botState.isTakenOver(stopKey) || isQuietHours() || botState.capReached()) return;
  const wait = (lastGroupReply.get(jid) ?? 0) + GROUP_MIN_GAP_MS - Date.now();
  if (wait > 0) {
    entry.timer = setTimeout(() => replyToGroup(jid), wait);
    return;
  }

  busy.add(jid);
  try {
    const burst = entry.messages.filter((m) => Date.now() - m.receivedAt < STALE_REPLY_MS);
    groupPending.delete(jid);
    if (!burst.length) return;

    const combined = burst.map((m) => m.text).join('\n');
    // In a group the bot is openly a bot, so bot questions and caps are fine; real anger/urgency is not.
    // Your own messages (swearing at the bot, etc.) never trigger the upset guard.
    if (isUpset(burst.filter((m) => !m.key.fromMe).map((m) => m.text).join('\n'))) {
      botState.takeOver(groupKey);
      await notifyOwner(`⚠️ ${subject}: someone sounds upset or urgent. Bot stayed quiet there.\n\n${burst.map((m) => `${m.name}: ${m.text}`).join('\n')}`);
      return;
    }

    const history = loadHistory(groupKey);
    log(`   [${subject}] writing a reply to ${burst.length} message(s)...`);
    // Don't await: read receipts in groups can hang and would block every future reply.
    sock.readMessages(burst.filter((m) => !m.key.fromMe).map((m) => m.key)).catch((err) => log('   read receipt failed:', err.message));
    const stopTyping = keepTyping(jid);
    let reply;
    try {
      const imageAsk = burst.map((m) => m.text).reverse().find((t) => IMAGE_RE.test(t) && /\bbot\b|بوت|🤖/i.test(t));
      if (imageAsk) {
        const prompt = await imagePrompt(imageAsk);
        log(`   [${subject}] generating image: ${prompt}`);
        try {
          const image = await generateImage(prompt);
          const sent = await sock.sendMessage(jid, { image, caption: `${GROUP_LABEL}${prompt}` });
          if (sent?.key?.id) botSentIds.add(sent.key.id);
        } catch (err) {
          log(`   image failed: ${err.message}`);
        }
      }
      const placeNotes = await sendPlaceInfo(jid, subject, combined, history).catch((err) => {
        log(`   place info failed: ${err.message}`);
        return '';
      });
      const task = TASK_RE.test(combined) || Boolean(placeNotes);
      let notes = placeNotes;
      if (task) {
        // Real request: several focused searches, fewer characters per page to fit the model's context.
        const queries = await planQueries(combined, history).catch(() => []);
        log(`   [${subject}] helper mode, searching: ${queries.join(' | ')}`);
        const results = await Promise.all(queries.map((q) => research(q, { pages: 2, chars: 1200 }).catch(() => '')));
        notes = [placeNotes, ...results].filter(Boolean).join('\n\n---\n\n');
      } else {
        const query = await researchQuery(combined, history).catch(() => null);
        notes = [placeNotes, query ? await research(query).catch(() => '') : ''].filter(Boolean).join('\n\n---\n\n');
        if (query) log(`   [${subject}] researched: "${query}"`);
      }
      reply = await composeGroupReply(group, subject, history.slice(task ? -6 : 0), burst, notes, task);
    } finally {
      stopTyping();
    }
    appendHistory(groupKey, 'user', burst.map((m) => `${m.name}: ${m.text}`).join('\n'));
    if (!reply) return log(`   [${subject}] model returned an empty reply`);
    if (ownerQuiet || botState.isTakenOver(stopKey)) return log(`   [${subject}] reply discarded: bot was stopped meanwhile`);
    await sendHuman(jid, `${GROUP_LABEL}${reply}`);
    appendHistory(groupKey, 'assistant', reply);
    lastGroupReply.set(jid, Date.now());
    botState.countReply();
    log(`-> [${subject}] ${GROUP_LABEL}${reply}`);
  } catch (err) {
    log(`group reply in ${subject} failed:`, err.message);
  } finally {
    busy.delete(jid);
    if (groupPending.has(jid)) replyToGroup(jid);
  }
}

/** Email / calendar requests and their yes/no confirmations. Always answered privately in your self-chat. */
async function handleOwnerAction(text, history = loadHistory('owner')) {
  try {
    const confirmation = await confirmAction(text);
    if (confirmation) {
      await notifyOwner(confirmation);
      return true;
    }
    if (!ACTION_RE.test(text)) return false;
    log('   owner action requested, drafting...');
    await notifyOwner(await draftAction(text, history));
  } catch (err) {
    log('owner action failed:', err.message);
    await notifyOwner(`Couldn't do that: ${err.message}`);
  }
  return true;
}

/** Your "Message yourself" chat is a private chat with the bot: chat, search, images. */
const OWNER_CHAT = {
  mode: 'always',
  notes:
    `This is a private chat with ${config.ownerName} himself, the person who built you. Be his helpful, funny assistant. ` +
    'Answer questions fully (up to 6 lines is fine), help with anything he asks, and share links when useful.',
};

async function replyToOwner(jid, key, text) {
  if (busy.has('owner')) return;
  busy.add('owner');
  const stopTyping = keepTyping(jid);
  try {
    const history = loadHistory('owner');
    if (IMAGE_RE.test(text)) {
      const prompt = await imagePrompt(text);
      log(`   [owner chat] generating image: ${prompt}`);
      const image = await generateImage(prompt).catch((err) => log('   image failed:', err.message));
      if (image) {
        const sent = await sock.sendMessage(jid, { image, caption: `🤖 ${prompt}` });
        if (sent?.key?.id) botSentIds.add(sent.key.id);
      }
    }
    const placeNotes = await sendPlaceInfo(jid, 'owner chat', text, history).catch(() => '');
    const query = await researchQuery(text, history).catch(() => null);
    const notes = [placeNotes, query ? await research(query).catch(() => '') : ''].filter(Boolean).join('\n\n---\n\n');
    if (query) log(`   [owner chat] researched: "${query}"`);
    const burst = [{ key, name: config.ownerName, text }];
    const reply = await composeGroupReply(OWNER_CHAT, 'private chat', history, burst, notes);
    appendHistory('owner', 'user', text);
    if (!reply) return;
    await sendHuman(jid, `🤖 ${reply}`);
    appendHistory('owner', 'assistant', reply);
  } catch (err) {
    log('owner chat failed:', err.message);
  } finally {
    stopTyping();
    busy.delete('owner');
  }
}

async function onMessage(msg, type) {
  const { key } = msg;
  const jid = key.remoteJid;
  if (jid && isJidGroup(jid)) return onGroupMessage(msg, type);
  if (!jid || isJidGroup(jid) || isJidStatusBroadcast(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return;

  const ageS = Date.now() / 1000 - Number(msg.messageTimestamp ?? 0);
  if (ageS > MAX_MESSAGE_AGE_S) return;

  const text = textOf(msg);

  if (key.fromMe) {
    if (botSentIds.has(key.id) || type !== 'notify') return;
    if (isSelfChat(jid)) {
      if (text.startsWith('!')) await handleCommand(text);
      else if (text && !text.startsWith('🤖')) {
        const handled = await handleOwnerAction(text);
        if (!handled) await replyToOwner(jid, key, text);
      }
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
      const { number, group, text, picture } = JSON.parse(fs.readFileSync(full, 'utf8'));
      fs.unlinkSync(full); // delete first so a crash never sends twice
      if (group) {
        // Group sends are one-off messages you asked for; the bot never replies in groups.
        const groups = Object.values(await sock.groupFetchAllParticipating());
        const matches = groups.filter((g) => g.subject?.toLowerCase().includes(group.toLowerCase()));
        if (matches.length !== 1) {
          await notifyOwner(
            `Outbox: found ${matches.length} groups matching "${group}" (${matches.map((g) => g.subject).join(', ') || 'none'}), message not sent.`,
          );
          continue;
        }
        if (picture) {
          const image = await withTimeout(generateImage(await imagePrompt(picture)), 90_000, 'image generation took too long');
          log(`   outbox: uploading group picture for ${matches[0].subject}...`);
          await withTimeout(sock.updateProfilePicture(matches[0].id, image), 60_000, 'WhatsApp did not confirm the picture change');
          log(`   outbox: group picture updated`);
        }
        if (text) {
          await sendHuman(matches[0].id, text);
          log(`-> group ${matches[0].subject} (outbox): ${text}`);
        }
        continue;
      }
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
