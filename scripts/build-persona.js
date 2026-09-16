// Learn your texting style from WhatsApp chat exports.
// Usage:
//   node scripts/build-persona.js                 -> lists senders found in exports/*.txt
//   node scripts/build-persona.js --me "Shady"    -> writes config/style.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../src/config.js';
import { scriptOf } from '../src/language.js';

export { scriptOf };

const EXPORTS_DIR = path.join(ROOT, 'exports');
const OUT_FILE = path.join(ROOT, 'config', 'style.md');
const EXAMPLE_COUNT = 40;

const LINE_RE = [
  // Android: 16/09/2026, 10:15 - Name: message
  /^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),? (\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?) - ([^:]+): (.*)$/,
  // iOS: [16/09/2026, 10:15:22] Name: message
  /^\[(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),? (\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\] ([^:]+): (.*)$/,
];

const SKIP_RE =
  /^(<media omitted>|<attached:.*>|.*\bomitted>?$|this message was deleted|you deleted this message|missed (voice|video) call|null|تم حذف هذه الرسالة|<تم استبعاد الوسائط>)$/i;

export function parseExport(raw) {
  const messages = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\u202f/g, ' ');
    const match = LINE_RE.map((re) => line.match(re)).find(Boolean);
    if (match) {
      messages.push({ sender: match[3].trim(), text: match[4] });
    } else if (messages.length && line.trim()) {
      messages[messages.length - 1].text += `\n${line}`;
    }
  }
  return messages
    .map((m) => ({ ...m, text: m.text.replace(/<This message was edited>/gi, '').trim() }))
    .filter((m) => m.text && !SKIP_RE.test(m.text));
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HAS_EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Merge consecutive messages by the same sender into turns. */
function toTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const last = turns[turns.length - 1];
    if (last && last.sender === m.sender) last.text += `\n${m.text}`;
    else turns.push({ ...m });
  }
  return turns;
}

function pickExamples(pairs, count) {
  const byScript = {};
  for (const p of pairs) (byScript[scriptOf(p.me)] ??= []).push(p);
  for (const list of Object.values(byScript)) list.sort(() => Math.random() - 0.5);
  const picked = [];
  const scripts = Object.keys(byScript);
  // Round-robin across scripts so every language you use is represented.
  while (picked.length < count && scripts.some((s) => byScript[s].length)) {
    for (const s of scripts) if (byScript[s].length && picked.length < count) picked.push(byScript[s].pop());
  }
  return picked;
}

export function buildStyle(messages, me) {
  const mine = messages.filter((m) => m.sender === me);
  const words = mine.flatMap((m) => m.text.split(/\s+/));
  const emojiCount = {};
  for (const m of mine) for (const e of m.text.match(EMOJI_RE) ?? []) emojiCount[e] = (emojiCount[e] ?? 0) + 1;
  const topEmojis = Object.entries(emojiCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([e]) => e);
  const withEmoji = mine.filter((m) => HAS_EMOJI_RE.test(m.text)).length;
  const scripts = {};
  for (const m of mine) scripts[scriptOf(m.text)] = (scripts[scriptOf(m.text)] ?? 0) + 1;
  const pct = (n) => `${Math.round((100 * n) / Math.max(1, mine.length))}%`;

  const wordCount = {};
  for (const w of words.map((w) => w.toLowerCase().replace(/[^\p{L}\d]/gu, '')).filter((w) => w.length >= 2)) {
    wordCount[w] = (wordCount[w] ?? 0) + 1;
  }
  const topWords = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([w]) => w);

  const turns = toTurns(messages);
  const pairs = [];
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].sender === me && turns[i - 1].sender !== me && turns[i].text.length <= 300) {
      pairs.push({ them: turns[i - 1].text.slice(-300), me: turns[i].text });
    }
  }
  const examples = pickExamples(pairs, EXAMPLE_COUNT);

  return `## Stats from ${mine.length} of my real messages
- Average message length: ${(words.length / Math.max(1, mine.length)).toFixed(1)} words. I send several short messages rather than one long one.
- Languages/scripts I use: ${Object.entries(scripts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ${pct(n)}`)
    .join(', ')}
- Messages with emoji: ${pct(withEmoji)}${topEmojis.length ? `. Favourite emoji: ${topEmojis.join(' ')}` : ''}
- Words and spellings I use a lot: ${topWords.join(', ')}

## Real examples (Them -> Me). Match this tone, length, spelling and language mixing.
${examples.map((p) => `Them: ${p.them.replace(/\n/g, ' / ')}\nMe: ${p.me.replace(/\n/g, ' / ')}`).join('\n\n')}
`;
}

function main() {
  const meIdx = process.argv.indexOf('--me');
  const me = meIdx > -1 ? process.argv[meIdx + 1] : null;
  if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR);
  const files = fs.readdirSync(EXPORTS_DIR).filter((f) => f.endsWith('.txt'));
  if (!files.length) {
    console.log(`No .txt files in ${EXPORTS_DIR}. Export chats from WhatsApp (chat > More > Export chat > Without media).`);
    process.exit(1);
  }
  const messages = files.flatMap((f) => parseExport(fs.readFileSync(path.join(EXPORTS_DIR, f), 'utf8')));

  if (!me) {
    const counts = {};
    for (const m of messages) counts[m.sender] = (counts[m.sender] ?? 0) + 1;
    console.log('Senders found (use your own name with --me "Name"):');
    for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${name}`);
    return;
  }
  if (!messages.some((m) => m.sender === me)) {
    console.log(`No messages from "${me}". Run without --me to see the sender names.`);
    process.exit(1);
  }
  fs.writeFileSync(OUT_FILE, buildStyle(messages, me));
  console.log(`Wrote ${OUT_FILE}. The bot picks it up on the next message.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
