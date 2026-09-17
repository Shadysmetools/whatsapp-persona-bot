import { chat } from './llm.js';

/** "draw / make an image / ارسم / e3melly sora ..." style requests. */
export const IMAGE_RE =
  /\b(draw|sketch|paint|generate (an? )?(image|picture|pic|photo)|make (me )?(an? )?(image|picture|pic|photo)|create (an? )?(image|picture|pic)|image of|picture of|ersem|ersemly|e3melly sora|sora le)\b|(ارسم|ارسملي|اعمل صورة|اعملي صورة|صورة ل)/i;

/** Turn a chat request (any language) into a short English image prompt. */
export async function imagePrompt(request) {
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          'Turn the WhatsApp request into a short, vivid English image-generation prompt (max 40 words). ' +
          'No real people\'s faces, nothing sexual, violent or hateful - if asked, make a cute cartoon version instead. Output only the prompt.',
      },
      { role: 'user', content: request },
    ],
    { maxTokens: 80, temperature: 0.7 },
  );
  return answer.replace(/^["']|["']$/g, '').trim();
}

/** Free image generation via Pollinations.ai (no API key). Returns a JPEG buffer. */
export async function generateImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&safe=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
    throw new Error(`image service returned ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
