// Minimal Google Calendar + Gmail client using OAuth (no extra dependencies).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const CREDENTIALS_FILE = path.join(config.configDir, 'google-credentials.json');
export const TOKEN_FILE = path.join(config.dataDir, 'google-token.json');
export const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send'];
export const TIMEZONE = process.env.TIMEZONE ?? 'Africa/Cairo';

export const googleReady = () => fs.existsSync(CREDENTIALS_FILE) && fs.existsSync(TOKEN_FILE);

export function loadClient() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const { client_id, client_secret } = raw.installed ?? raw.web ?? raw;
  return { client_id, client_secret };
}

let cached = null;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const { client_id, client_secret } = loadClient();
  const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google sign-in expired or invalid (${data.error}). Run: npm run google-auth`);
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function google(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Google API error ${res.status}`);
  return data;
}

/** start/end are local "YYYY-MM-DDTHH:MM" strings in TIMEZONE. */
export function createEvent({ title, start, end, location, description, attendees = [] }) {
  return google(`https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${attendees.length ? 'all' : 'none'}`, {
    summary: title,
    location,
    description,
    start: { dateTime: `${start}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${end}:00`, timeZone: TIMEZONE },
    attendees: attendees.map((email) => ({ email })),
    reminders: { useDefault: true },
  });
}

const encodeHeader = (text) => (/^[\x00-\x7F]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`);

export function sendEmail({ to, cc = [], subject, body }) {
  const mime = [
    `To: ${[].concat(to).join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ]
    .filter((line) => line !== null)
    .join('\r\n');
  return google('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    raw: Buffer.from(mime).toString('base64url'),
  });
}
