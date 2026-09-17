import { config } from './config.js';

// Detects "am I talking to a bot?" style questions in English, Franco and Arabic.
const BOT_PATTERNS = [
  /\b(bot|robot|chat ?gpt|chatbot|a\.?i\.?|agent|artificial|automated|auto[- ]?reply)\b/i,
  /\b(is (this|that) (really )?you|are you real|real you|who is (this|typing))\b/i,
  /(بوت|روبوت|ذكاء اصطناعي|رد آلي|رد الي|شات جي بي تي|ده انت|دا انت|انت بجد)/,
  /\b(enta|inta|enty) (bot|robot|b[e3]gad|bgd)\b/i,
];

// Upset, urgent or angry messages that a person must handle.
const UPSET_PATTERNS = [
  /\b(call me|kalemny|kallemny|etasel|not ok|not okay|wtf|fuck|shit|angry|upset|emergency|urgent|hospital|accident|help me)\b/i,
  /\b(za3lana|za3lan|m5no2|mekhno2|7aram 3aleik|ya5raby|mesh tamam|msh tamam)\b/i,
  /(كلمني|اتصل|مش تمام|زعلان|زعلانة|مخنوق|حرام عليك|طوارئ|مستشفى|حادثة|الحقني|عيب)/,
];

const isShouting = (text) => {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 8 && letters === letters.toUpperCase();
};

export const asksIfBot = (text) => BOT_PATTERNS.some((re) => re.test(text));

/** Returns a reason when a human must answer instead of the bot, otherwise null. */
export function needsHuman(text) {
  if (asksIfBot(text)) return 'asking if they are talking to a bot';
  if (isShouting(text)) return 'writing in ALL CAPS (upset or urgent)';
  if (UPSET_PATTERNS.some((re) => re.test(text))) return 'sounds upset or urgent';
  return null;
}

/** A reply that talks about the owner in the third person gives the bot away. */
export function breaksPersona(reply) {
  const owner = config.ownerName.toLowerCase();
  return (
    new RegExp(`\\b${owner}\\b`, 'i').test(reply) ||
    /\b(he's|he is|he'll|he will|tell him|i'll tell him|his phone|him)\b/i.test(reply) ||
    /\b(assistant|as an ai|language model)\b/i.test(reply)
  );
}
