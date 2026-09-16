import { config } from './config.js';

export async function chat(messages, { maxTokens = 400, temperature = 0.8 } = {}) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      // Keep the model loaded forever: a cold load takes ~80s, a warm reply ~8s.
      keep_alive: -1,
      options: { num_ctx: config.numCtx, num_predict: maxTokens, temperature },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message.content.trim();
}

/** Fails loudly if Ollama is down or the model is missing, then warms the model up. */
export async function ensureModel() {
  let tags;
  // After a reboot Ollama may still be starting: keep trying for up to 10 minutes.
  for (let attempt = 1; !tags; attempt++) {
    try {
      tags = await (await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })).json();
    } catch {
      if (attempt >= 60) throw new Error(`Ollama is not reachable at ${config.ollamaUrl}. Start Ollama first.`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  const names = tags.models.map((m) => m.name);
  if (!names.includes(config.model)) {
    throw new Error(
      `Model ${config.model} not found in Ollama (found: ${names.join(', ') || 'none'}). ` +
        'Check that the OLLAMA_MODELS environment variable points at E:\\ollama-models and restart Ollama.',
    );
  }
  await chat([{ role: 'user', content: 'hi' }], { maxTokens: 1 });
}
