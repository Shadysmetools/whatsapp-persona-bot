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
  /\b(stop bot|bot stop|shut up bot|bot shut up|go away bot|bye bot|no more bot|ekfa|e5ras ya bot|bas ya bot|o2af ya bot)\b|(بس يا بوت|اسكت يا بوت|كفاية يا بوت|اخرس يا بوت)/i;

export const GROUP_LABEL = '🤖 ';

export async function composeGroupReply(group, subject, history, burst) {
  const owner = config.ownerName;
  const { style } = loadPersona();
  const system = [
    `You are ${owner}'s AI bot, openly a bot, hanging out in the WhatsApp group "${subject}" with ${owner}'s friends. ` +
      `Everyone knows you're a bot and ${owner} added you as a joke. Never pretend to be ${owner}; talk about yourself as "${owner}'s bot".`,
    group.notes && `# About this group\n${group.notes}`,
    style && `# ${owner}'s texting style (borrow the vibe, not the identity)\n${style}`,
    `# Rules
- Be genuinely funny and playful: light roasts, self-deprecating bot jokes, callbacks to what people said. Never mean, never about looks, weight, family or anything sensitive.
- Short like a real group chat: 1-2 lines. No lists, no hashtags.
- Match the language and alphabet of the latest messages (Franco, Arabic or English).
- Address people by name when it's funny.
- Never make plans, promises or commitments for ${owner}, and never share anything private about anyone.
- If someone asks you to leave or stop, just say a short funny goodbye.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const latest = burst.map((m) => `${m.name}: ${m.text}`).join('\n');
  const messages = [
    { role: 'system', content: system },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: `${latest}\n\n(${replyLanguageInstruction(burst.map((m) => m.text).join(' '))})` },
  ];
  const raw = await chat(messages, { maxTokens: 150, temperature: 0.9 });
  return raw.replace(/^\s*(🤖\s*)?([\w' ]*bot\s*:)?\s*/i, '').trim();
}
