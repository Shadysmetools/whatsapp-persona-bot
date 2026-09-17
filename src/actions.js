// Owner-only email and calendar actions, always confirmed with "yes" before anything happens.
import { createEvent, googleReady, sendEmail, TIMEZONE } from './google.js';
import { chat } from './llm.js';

const EMAIL_RE = /\b(e-?mail|mail)\b|(ايميل|إيميل|بريد)/i;
const EVENT_RE =
  /\b(calendar|schedule|meeting|reminder|remind me|event|invite|appointment|book)\b|(الكالندر|ميعاد|اجتماع|فكرني|موعد)/i;
export const ACTION_RE = new RegExp(`${EMAIL_RE.source}|${EVENT_RE.source}`, 'i');
export const YES_RE = /^\s*(yes|y|yep|yeah|send|send it|confirm|ok send|do it|create it|aywa|aiwa|tamam|اه|أيوه|ايوه|تمام|ابعت)\s*[.!]*\s*$/i;
export const NO_RE = /^\s*(no|n|nope|cancel|stop|don'?t|la2|laa|لا|الغي)\s*[.!]*\s*$/i;

let pending = null; // { action, createdAt }

function localNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday };
}

const TEMPLATES = {
  email:
    '{"to": ["exact@address.com"], "cc": [], "subject": "...", "body": "...", "missing": ""}\n' +
    'Only use email addresses written literally in the request or chat; never invent one. If there is no address, set "to": [] and "missing": "recipient email address". ' +
    'Write the body politely in the language of the request and sign it "Shady".',
  event:
    '{"title": "...", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "location": "", "description": "", "attendees": [], "missing": ""}\n' +
    'Use 24h times. Default length 1 hour. "tonight" with no time = 20:00, "after work" = 18:00, "morning" = 09:00. ' +
    'Only put email addresses written literally in the request into attendees. If the date/time can\'t be worked out, set "missing": "date and time".',
};

/** Turn a free-text request into a structured email or calendar event. */
export async function parseAction(request, history, { debug = false } = {}) {
  const kind = EMAIL_RE.test(request) && !/\b(calendar|remind me)\b/i.test(request) ? 'email' : 'event';
  const now = localNow();
  const recent = history
    .slice(-6)
    .map((m) => m.content)
    .join('\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content: `Today is ${now.weekday} ${now.date}, current time ${now.time} (${TIMEZONE}). "Tomorrow" is the day after ${now.date}.\nFill this JSON for the request and output only the JSON:\n${TEMPLATES[kind]}`,
      },
      { role: 'user', content: `${recent ? `Recent chat:\n${recent}\n\n` : ''}Request:\n${request}` },
    ],
    { maxTokens: 500, temperature: 0, json: true },
  );
  if (debug) console.log('RAW:', answer);
  return { kind, ...JSON.parse(answer) };
}

export function preview(action) {
  if (action.kind === 'email') {
    return `📧 *Email draft*\n*To:* ${action.to?.join(', ') || '❓'}${action.cc?.length ? `\n*Cc:* ${action.cc.join(', ')}` : ''}\n*Subject:* ${action.subject}\n\n${action.body}`;
  }
  return `📅 *Calendar event*\n*${action.title}*\n🕒 ${action.start?.replace('T', ' ')} → ${action.end?.replace('T', ' ')} (${TIMEZONE})${action.location ? `\n📍 ${action.location}` : ''}${action.attendees?.length ? `\n👥 ${action.attendees.join(', ')}` : ''}${action.description ? `\n📝 ${action.description}` : ''}`;
}

const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const validTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s ?? '');

/** Owner asked for an email/event: draft it and wait for confirmation. Returns the message to show. */
export async function draftAction(request, history, { skipGoogleCheck = false } = {}) {
  if (!skipGoogleCheck && !googleReady()) {
    return "⚙️ Email & calendar aren't connected yet. On the PC run: *npm run google-auth* (see README \"Email & calendar\").";
  }
  const action = await parseAction(request, history);
  if (action.kind === 'email') {
    action.to = (action.to ?? []).filter(validEmail);
    action.cc = (action.cc ?? []).filter(validEmail);
    // Never trust an address the model may have invented: it must appear in what you wrote.
    action.to = action.to.filter((a) => request.toLowerCase().includes(a.toLowerCase()));
    if (!action.to.length) action.missing ||= 'recipient email address';
  } else {
    action.attendees = (action.attendees ?? []).filter((a) => validEmail(a) && request.toLowerCase().includes(a.toLowerCase()));
    // The model often gets relative days wrong; fix them from the words you used.
    const { date } = localNow();
    const shift = /\b(tomorrow|bokra)\b|بكرة|بكره/i.test(request) ? 1 : /\b(today|tonight|this (evening|afternoon|morning)|ennaharda|elnaharda)\b|النهارده|الليلة/i.test(request) ? 0 : null;
    if (shift !== null && validTime(action.start) && validTime(action.end)) {
      const day = new Date(`${date}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + shift);
      const target = day.toISOString().slice(0, 10);
      const spansMidnight = action.end.slice(0, 10) > action.start.slice(0, 10);
      action.start = `${target}${action.start.slice(10)}`;
      if (spansMidnight) {
        day.setUTCDate(day.getUTCDate() + 1);
        action.end = `${day.toISOString().slice(0, 10)}${action.end.slice(10)}`;
      } else {
        action.end = `${target}${action.end.slice(10)}`;
      }
    }
    if (!validTime(action.start) || !validTime(action.end)) action.missing ||= 'date and time';
  }
  if (action.missing) return `I need one more thing first: *${action.missing}*. Ask again with it included 🙏`;
  pending = { action, createdAt: Date.now() };
  return `${preview(action)}\n\nReply *yes* to ${action.kind === 'email' ? 'send' : 'create'} it, or *no* to cancel.`;
}

export const hasPending = () => Boolean(pending && Date.now() - pending.createdAt < 30 * 60_000);

/** Handle "yes"/"no" for the pending action. Returns a message, or null if the text wasn't a confirmation. */
export async function confirmAction(text) {
  if (!hasPending()) return null;
  if (NO_RE.test(text)) {
    pending = null;
    return 'Cancelled, nothing was sent 👍';
  }
  if (!YES_RE.test(text)) return null;
  const { action } = pending;
  pending = null;
  if (action.kind === 'email') {
    await sendEmail(action);
    return `✅ Email sent to ${action.to.join(', ')}`;
  }
  const event = await createEvent(action);
  return `✅ Added to your calendar: *${action.title}*\n${event.htmlLink}`;
}
