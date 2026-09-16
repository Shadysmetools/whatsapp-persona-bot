// Chat with the persona in the terminal - no WhatsApp involved.
// Usage: npm run try            (then type messages as the contact; Ctrl+C to quit)
//        npm run try -- --name Ahmed --notes "best friend, talks Franco"
import readline from 'node:readline/promises';
import { composeReply } from '../src/agent.js';
import { ensureModel } from '../src/llm.js';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const contact = { name: arg('--name') ?? 'Friend', notes: arg('--notes') };

console.log('Loading model...');
await ensureModel();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const history = [];

for (;;) {
  const incoming = await rl.question(`${contact.name}: `);
  if (!incoming.trim()) continue;
  const started = Date.now();
  const reply = await composeReply(contact, history, incoming);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (reply.query) console.log(`   (researched: "${reply.query}")`);
  console.log(`You (bot, ${secs}s): ${reply.text}`);
  if (reply.escalation) console.log(`   [would notify you: ${reply.escalation}]`);
  history.push({ role: 'user', content: incoming }, { role: 'assistant', content: reply.text });
}
