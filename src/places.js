import { chat } from './llm.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36';

/** "show me the menu", "send location", "what's their number"... */
export const MENU_RE = /\b(menu|menus|menyu|el menu)\b|(منيو|المنيو|قائمة الطعام)/i;
export const LOCATION_RE =
  /\b(location|address|where is|where's|map|maps|directions|pin|3enwan|el 3enwan|lokeshn|location el)\b|(عنوان|لوكيشن|مكان|خريطة)/i;
export const PHONE_RE = /\b(number|phone|call them|contact|hotline|rakam|nemra|nimra)\b|(رقم|تليفون|هوت لاين)/i;

/** Pull the restaurant/place names the person means, using the recent chat for context. */
export async function extractPlaces(request, history, fallbackArea = 'New Cairo, Egypt') {
  const recent = history
    .slice(-6)
    .map((m) => m.content)
    .join('\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          'Extract the restaurant/shop/place names the latest message refers to (use the recent chat to resolve "it", "them", "that place"). ' +
          `Return JSON only: [{"name": "...", "area": "..."}], max 3 items. If no area is mentioned use "${fallbackArea}". If none, return [].`,
      },
      { role: 'user', content: `${recent ? `Recent chat:\n${recent}\n\n` : ''}Latest message:\n${request}` },
    ],
    { maxTokens: 120, temperature: 0 },
  );
  try {
    const json = JSON.parse(answer.slice(answer.indexOf('['), answer.lastIndexOf(']') + 1));
    return json.filter((p) => p?.name).slice(0, 3);
  } catch {
    return [];
  }
}

/** Free image search via DuckDuckGo. Returns image URLs. */
export async function imageSearch(query, limit = 3) {
  const page = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(15_000),
  }).then((r) => r.text());
  const vqd = page.match(/vqd=["']?([\d-]+)["']?/)?.[1];
  if (!vqd) return [];
  const res = await fetch(
    `https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
    { headers: { 'user-agent': UA, referer: 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) return [];
  const { results = [] } = await res.json();
  return results.slice(0, limit * 2).map((r) => r.image);
}

/** Download images, skipping anything that isn't a reasonably sized picture. */
export async function downloadImages(urls, limit = 3) {
  const images = [];
  for (const url of urls) {
    if (images.length >= limit) break;
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 20_000 && buf.length < 5_000_000) images.push(buf);
    } catch {
      // try the next one
    }
  }
  return images;
}

/** Free geocoding via OpenStreetMap Nominatim. */
export async function geocode(name, area) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${name}, ${area}`)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'whatsapp-persona-bot/1.0 (personal use)' },
    signal: AbortSignal.timeout(15_000),
  });
  const [hit] = res.ok ? await res.json() : [];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), address: hit.display_name } : null;
}

export const mapsLink = (name, area) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${area}`)}`;

/** Egyptian-style phone numbers found in research text (hotlines like 19xxx, mobiles, landlines). */
export function findPhones(text) {
  const found = text.match(/(?<!\d)(1[569]\d{3}|01[0125]\d{8}|\+?20\s?1[0125]\s?\d{4}\s?\d{4}|0?2\s?\d{4}\s?\d{4})(?!\d)/g) ?? [];
  return [...new Set(found.map((p) => p.replace(/\s/g, '')))].slice(0, 3);
}
