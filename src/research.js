const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36';

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function resolveHref(href) {
  const url = decodeEntities(href);
  const uddg = url.match(/[?&]uddg=([^&]+)/);
  if (uddg) return decodeURIComponent(uddg[1]);
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Free web search via DuckDuckGo's HTML endpoint (no API key). */
export async function webSearch(query, limit = 5) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }),
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  return links.slice(0, limit).map((m, i) => ({
    url: resolveHref(m[1]),
    title: stripTags(m[2]),
    snippet: snippets[i] ? stripTags(snippets[i][1]) : '',
  }));
}

export async function fetchPageText(url, maxChars = 2500) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'en,ar;q=0.8' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return '';
    const html = await res.text();
    const body = html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    return stripTags(body).slice(0, maxChars);
  } catch {
    return '';
  }
}

/** Search, read the top pages, and return a compact notes block for the reply prompt. */
export async function research(query) {
  const results = await webSearch(query);
  if (!results.length) return '';
  const pages = await Promise.all(results.slice(0, 3).map((r) => fetchPageText(r.url)));
  const sources = results.map((r, i) => {
    const body = pages[i] ? `\n${pages[i]}` : '';
    return `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}${body}`;
  });
  return `Search query: ${query}\n\n${sources.join('\n\n')}`;
}
