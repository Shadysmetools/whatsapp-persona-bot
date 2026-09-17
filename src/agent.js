import { config, loadPersona } from './config.js';
import { replyLanguageInstruction } from './language.js';
import { chat } from './llm.js';
import { research } from './research.js';

const ESCALATE_RE = /\[\[\s*ESCALATE\s*:?\s*([^\]]*)\]\]/i;

// Used until you build config/style.md from your own chat exports.
const DEFAULT_STYLE = `Them: ezayak ya basha, 3amel eh?
Me: el7amdulillah tamam, w enta 3amel eh?

Them: fady bokra nenzel?
Me: msh 3aref lsa, hashoof el denya w a2olak

Them: عامل ايه يا صاحبي
Me: الحمد لله تمام يا باشا، وانت عامل ايه؟

Them: how's work going?
Me: busy as usual haha, you?`;

/** Ask the model whether answering needs the web. Returns a search query or null. */
export async function researchQuery(incoming, history) {
  if (!config.research || incoming.replace(/\s/g, '').length < 12) return null;
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Them' : 'Me'}: ${m.content}`)
    .join('\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          'You decide if replying to the latest WhatsApp message needs looking things up on the internet ' +
          '(prices, products, specs, news, places, opening hours, how-to steps, facts, recommendations). ' +
          'Casual chat, greetings, jokes, feelings, plans, favours, requests to borrow money or for personal help, ' +
          'and questions about the person themself do NOT need it. Only search when a general fact makes the answer better. ' +
          'Messages may be in Egyptian Arabic, Franco Arabic (Arabic in Latin letters with digits like 2 3 5 7) or English. ' +
          'Output exactly one line: NO, or SEARCH: <short search query in English, add "Egypt" if location matters>.',
      },
      { role: 'user', content: `${recent ? `Recent chat:\n${recent}\n\n` : ''}Latest message:\n${incoming}` },
    ],
    { maxTokens: 40, temperature: 0 },
  );
  const match = answer.match(/SEARCH:\s*(.+)/i);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

/** Real requests for help: search, recommend, plan, find, compare... */
export const TASK_RE =
  /\b(search|look up|google|find|recommend|recommendation|suggest|plan|planning|itinerary|what to (watch|order|eat|do)|where (to|can|should)|compare|best|review|explain|how (to|do|can)|shoof|dawar|e2tera7|2tra7)\b|(ابحث|دور|اقترح|رشح|خطة|نظم)/i;

/** For a real task, ask the model for up to 3 focused web searches. */
export async function planQueries(request, history) {
  const recent = history
    .slice(-4)
    .map((m) => m.content)
    .join('\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          'Break the request into 1-3 focused web search queries in English that together give everything needed to answer it well ' +
          '(e.g. one for movies, one for where to stream them, one for restaurants near the location). ' +
          'For food/delivery use queries like "best rated delivery restaurants near <place> New Cairo Talabat", ' +
          '"<place> restaurants Google Maps reviews" or "Breadfast offers this week Egypt". ' +
          'Add the city/country when location matters (default Egypt). Output one query per line, nothing else.',
      },
      { role: 'user', content: `${recent ? `Context:\n${recent}\n\n` : ''}Request:\n${request}` },
    ],
    { maxTokens: 80, temperature: 0 },
  );
  return answer
    .split('\n')
    .map((l) => l.replace(/^[\d.\-*\s"]+|"$/g, '').trim())
    .filter((l) => l.length > 3)
    .slice(0, 3);
}

export function buildSystemPrompt(contact, notes) {
  const owner = config.ownerName;
  const { aboutMe, style } = loadPersona();
  const identity = config.discloseAi
    ? `You are ${owner}'s personal assistant, replying on WhatsApp from ${owner}'s phone while ${owner} is busy. ` +
      `Say so naturally when you start a conversation, then text in ${owner}'s style.`
    : `You are ${owner}, texting on WhatsApp from your own phone. Write exactly as ${owner} would. Don't bring up AI, bots or assistants.`;

  return [
    identity,
    aboutMe && `# About ${owner}\n${aboutMe}`,
    `# How ${owner} texts (copy this style closely: length, slang, spelling)\n${style || DEFAULT_STYLE}`,
    `# Who you're talking to\nName: ${contact.name || 'unknown'}${contact.notes ? `\nNotes: ${contact.notes}` : ''}`,
    `# Rules
- Always reply in the same language AND the same alphabet as their latest message. Franco Arabic gets Franco Arabic (Latin letters), Arabic letters get Arabic letters, English gets English.
- Text like a real person on WhatsApp: short and casual, usually 1-2 lines. No bullet lists, no headings, no formal politeness.
- To send two separate messages, put a blank line between them. Never more than 3.
- Actually help. If they ask for info, advice or a recommendation, give a concrete, correct, useful answer in your own voice. Short but complete.
- Don't invent facts about ${owner}'s plans, location, schedule, money, work or relationships.
- Never agree to meetings, plans, payments, loans, deals or promises, and never share addresses, passwords or codes. Say something friendly like you'll check and get back to them.
- If they ask whether they're talking to a bot or AI, don't answer the question at all: output ONLY the line [[ESCALATE: asked if bot]] and nothing else, so ${owner} can reply personally.`,
    `# Flagging for ${owner}
Most messages (greetings, small talk, questions you answered) must NOT be flagged.
Only when one of these happens, add a final separate line [[ESCALATE: short reason in English]]:
a) they ask for money, a meeting, a plan, a favour or a commitment;
b) something urgent, sad or serious (bad news, emergency, conflict);
c) they need a personal fact about ${owner} you don't know;
d) they asked whether you're a bot.`,
    notes &&
      `# Web research you just did (use it to answer accurately; no links unless they ask; don't mention searching)\n${notes}`,
    `Current date and time: ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function parseReply(raw) {
  const escalate = raw.match(ESCALATE_RE);
  const text = raw
    .replace(ESCALATE_RE, '')
    .replace(new RegExp(`^\\s*${config.ownerName}\\s*:\\s*`, 'i'), '')
    .trim();
  return { text, escalation: escalate ? escalate[1].trim() || 'needs your attention' : null };
}

/**
 * Produce a reply for the contact's latest message(s).
 * history: [{ role: 'user'|'assistant', content }], incoming: the new text (bursts joined by newlines).
 */
export async function composeReply(contact, history, incoming) {
  let notes = '';
  const query = await researchQuery(incoming, history).catch(() => null);
  if (query) notes = await research(query).catch(() => '');

  const messages = [
    { role: 'system', content: buildSystemPrompt(contact, notes) },
    ...history.map(({ role, content }) => ({ role, content })),
    // Small local models drift into the wrong language, so restate it right next to the message.
    { role: 'user', content: `${incoming}\n\n(${replyLanguageInstruction(incoming)})` },
  ];
  const raw = await chat(messages, { maxTokens: notes ? 500 : 250 });
  return { ...parseReply(raw), query };
}
