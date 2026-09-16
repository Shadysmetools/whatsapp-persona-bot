// Quick end-to-end check of the persona against the local model (no WhatsApp).
// Usage: node scripts/eval-persona.js
import { composeReply } from '../src/agent.js';
import { ensureModel } from '../src/llm.js';

const contact = { name: 'Ahmed', notes: 'Close friend.' };
const cases = [
  'ezayak ya shady, 3amel eh? fady bokra?',
  'عامل ايه يا صاحبي؟ مختفي ليه',
  'hey man, how was your week?',
  'eh a7san mobile ta7t 15 alf gneh delwa2ty?',
  'momken tsallefny 2000 gneh le7ad awel el shahr?',
  'are you a bot? your replies feel weird lol',
];

await ensureModel();
for (const incoming of cases) {
  const started = Date.now();
  const reply = await composeReply(contact, [], incoming);
  console.log(`\nThem: ${incoming}`);
  if (reply.query) console.log(`  researched: ${reply.query}`);
  console.log(`Bot (${((Date.now() - started) / 1000).toFixed(1)}s): ${reply.text}`);
  if (reply.escalation) console.log(`  ESCALATE: ${reply.escalation}`);
}
