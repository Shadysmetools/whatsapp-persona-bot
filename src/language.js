const FRANCO_WORDS =
  /\b(ana|enta|enty|inta|mesh|msh|la2|aywa|ezayak|ezayek|3amel|3amla|keda|ba2a|tab|yalla|khalas|5alas|leh|eh|delwa2ty|bokra|wallahi|habibi|m3lsh|ma3lesh|inshallah|isa|el7amdulillah|7elw|gamed|fady|3ayez|3awz|momken|3shan|3ashan|ya3ny|kda|akid|tamam)\b/i;

/** Classify the script of a message: arabic, franco, english, or emoji (no letters). */
export function scriptOf(text) {
  const letters = text.replace(/[^\p{L}\d]/gu, '');
  if (!letters) return 'emoji';
  const arabic = (text.match(/\p{Script=Arabic}/gu) ?? []).length;
  if (arabic / letters.length > 0.4) return 'arabic';
  const franco = /\b\w*[a-z][2378]\w*\b|\b[2378][a-z]\w*\b/i.test(text) || FRANCO_WORDS.test(text);
  if (franco) return 'franco';
  return /[a-z]/i.test(text) ? 'english' : 'other';
}

const INSTRUCTIONS = {
  arabic: 'Reply in Egyptian Arabic (عامية مصرية) written in Arabic letters. Not Levantine, not formal Arabic.',
  franco:
    'Reply in Franco Arabic: Egyptian Arabic written in LATIN letters with digits (2=ء 3=ع 5=خ 7=ح), e.g. "la2 msh fady bokra 3andy shoghl". Do NOT use Arabic letters.',
  english: 'Reply in the same Latin-script language they wrote in (usually casual English). Do NOT use Arabic letters.',
  other: 'Reply in the same language they wrote in.',
  emoji: 'Reply with a short casual reaction, matching the language of the recent chat.',
};

export const replyLanguageInstruction = (text) => INSTRUCTIONS[scriptOf(text)];
