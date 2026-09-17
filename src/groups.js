import fs from 'node:fs';
import path from 'node:path';
import { config, loadPersona } from './config.js';
import { replyLanguageInstruction } from './language.js';
import { chat } from './llm.js';

/** Groups where the openly-labelled bot may join in. Re-read on every message. */
export function loadGroupList() {
  const file = path.join(config.configDir, 'groups.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).groups ?? [];
}

export const findGroupConfig = (subject) =>
  loadGroupList().find((g) => subject?.toLowerCase().includes(String(g.match).toLowerCase()));

/** Anyone in the group can send the bot away. */
export const STOP_RE =
  /\b(stop bot|bot stop|terminate bot|kill bot|shut up bot|bot shut up|go away bot|bye bot|no more bot|ekfa|e5ras ya bot|bas ya bot|o2af ya bot)\b|(بس يا بوت|اسكت يا بوت|كفاية يا بوت|اخرس يا بوت)/i;

export const GROUP_LABEL = '🤖 ';

/** In "mention" groups the bot only speaks when called like this. */
export const SUMMON_RE = /(^|\s)(@bot|hey bot|hi bot|ya bot|yo bot|ya botty)\b|^\s*bot\s*[,:!?]|🤖|(يا بوت)/iu;

export const START_RE = /\b(start bot|bot start|come back bot|bot come back|rga3 ya bot|erga3 ya bot)\b|(ارجع يا بوت)/i;

const botPersonaFile = path.join(config.dataDir, 'bot-persona.txt');

/** The bot's group personality, changeable from WhatsApp. Empty = default. */
export const getBotPersona = () => (fs.existsSync(botPersonaFile) ? fs.readFileSync(botPersonaFile, 'utf8').trim() : '');

export function setBotPersona(text) {
  if (text) fs.writeFileSync(botPersonaFile, text.slice(0, 500));
  else if (fs.existsSync(botPersonaFile)) fs.unlinkSync(botPersonaFile);
}

/** Owner writing "bot group pic: <description>" or sending/replying to a photo with "bot group pic". */
export const GROUP_PIC_RE =
  /\bbot\b.*?\b(change|set|update|put|make|replace|use|8ayar|ghayar|7ot)\b.*?\bgroup\s*(pic|picture|photo|image|icon|sora|dp|profile)\b\s*(to|with|into|as|:|=|le|l)?\s*(?<desc>.*)$|\bbot\b.*?\b(8ayar|ghayar|change|set)\s+(el\s+)?(pic|picture|photo|image|sora)\s+(el\s+)?group\b\s*(to|with|into|as|:|=|le|l)?\s*(?<desc3>.*)$|^\s*!?\s*bot\s+group\s*(?:pic|picture|photo|image|icon|sora)\s*[:=]?\s*(?<desc2>.*)$/is;

/** Owner writing "bot persona: pirate" (or "bot persona reset") in a group. */
export const PERSONA_CMD_RE = /^\s*!?\s*bot\s+persona\s*[:=]?\s*(.*)$/is;

export async function composeGroupReply(group, subject, history, burst, notes = '', task = false) {
  const owner = config.ownerName;
  const { style } = loadPersona();
  const persona = getBotPersona();
  const system = [
    `You are ${owner}'s AI bot, openly a bot, hanging out in the WhatsApp group "${subject}" with ${owner}'s friends. ` +
      `Everyone knows you're a bot and ${owner} added you as a joke. Never pretend to be ${owner}; talk about yourself as "${owner}'s bot".`,
    persona &&
      `# Your current personality (set by ${owner} - fully play this character, but you're still openly ${owner}'s bot and all rules below still apply)\n${persona}`,
    group.notes && `# About this group\n${group.notes}`,
    style && `# ${owner}'s texting style (borrow the vibe, not the identity)\n${style}`,
    `# Rules
- Be genuinely funny and playful: light roasts, self-deprecating bot jokes, callbacks to what people said. Never mean, never about looks, weight, family or anything sensitive.
- Short like a real group chat: 1-2 lines. No lists, no hashtags.
- Match the language and alphabet of the latest messages (Franco, Arabic or English).
- Address people by name when it's funny.
- Never make plans, promises or commitments for ${owner}, and never share anything private about anyone.
- If someone asks you to leave or stop, just say a short funny goodbye.`,
    task &&
      `# HELPER MODE - someone asked you for real help (search / recommend / plan)
This overrides the "short" rule. Keep one funny opener line, then actually deliver:
- Concrete, specific answers with real names from the research (titles, year, where to stream, places, dishes, prices if known).
- For recommendations give 4-6 options, each with a one-line reason.
- For plans give a simple timeline (e.g. 8:00 pm order food, 8:45 pm movie...).
- For a "search X" request, summarise the key facts you found (what it is, latest season/news, why people like it).
- Paste 1-3 useful links at the end.
- WhatsApp formatting only: *bold*, line breaks, emoji bullets. No markdown headings or ** or tables. Max ~20 lines.
- Only use facts from the research or well-known facts; if you're not sure about a place near their location, say "check on Talabat".
- If important details are missing (budget, time, how many people, food preference, genre they hate), still give your best answer first, then end with 1-2 short questions to tailor it.`,
    notes &&
      `# Web research you just did\nUse it to answer accurately and helpfully. If they asked for links, sources or "send me", paste the 1-3 most useful URLs on their own lines. You may go a bit longer than usual (up to 5 lines) when sharing info.\n${notes}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const latest = burst.map((m) => `${m.name}: ${m.text}`).join('\n');
  const messages = [
    { role: 'system', content: system },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: `${latest}\n\n(${replyLanguageInstruction(burst.map((m) => m.text).join(' '))})` },
  ];
  const raw = await chat(messages, { maxTokens: task ? 900 : notes ? 400 : 150, temperature: task ? 0.6 : 0.9 });
  return toWhatsApp(raw.replace(/^\s*(🤖\s*)?([\w' ]*bot\s*:)?\s*/i, '').trim());
}

/** Convert markdown the model likes into WhatsApp formatting. */
export function toWhatsApp(text) {
  return text
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^(\s*)[*-]\s+/gm, (_, indent) => `${indent.length > 1 ? '   ◦ ' : '• '}`)
    .replace(/\n{3,}/g, '\n\n');
}
