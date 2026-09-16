import { config } from './config.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const rand = (min, max) => min + Math.random() * (max - min);

export function isQuietHours(date = new Date()) {
  const { quietStart: start, quietEnd: end } = config;
  if (start === end) return false;
  const h = date.getHours();
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Split a reply into at most 3 WhatsApp messages on blank lines. */
export function splitReply(text) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return parts;
  return [parts[0], parts[1], parts.slice(2).join('\n')];
}

/** How long a person would plausibly spend typing this text. */
export function typingMs(text) {
  return Math.min(12_000, Math.max(1_500, text.length * rand(45, 75)));
}

/** How long before a person "notices" a new message. */
export function seenDelayMs() {
  return rand(3_000, 25_000);
}
