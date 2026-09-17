// Detects "am I talking to a bot?" style questions in English, Franco and Arabic.
const PATTERNS = [
  /\b(bot|robot|chat ?gpt|chatbot|a\.?i\.?|artificial|automated|auto[- ]?reply)\b/i,
  /\b(is (this|that) (really )?you|are you real|real you|who is (this|typing))\b/i,
  /(بوت|روبوت|ذكاء اصطناعي|رد آلي|رد الي|شات جي بي تي|ده انت|دا انت|انت بجد)/,
  /\b(enta|inta|enty) (bot|robot|b[e3]gad|bgd)\b/i,
];

export const asksIfBot = (text) => PATTERNS.some((re) => re.test(text));
