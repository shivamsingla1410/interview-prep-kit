import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Research, SourceGap } from './types.js';

const PAGE_LIMIT = 6;
const BYTE_LIMIT = 500_000;
const TIMEOUT_MS = 8_000;

function privateAddress(address: string) {
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

export async function validateResearchUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP or HTTPS website URL.');
  if (process.env.NODE_ENV === 'production') {
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
    const records = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
    if (localHost || !records.length || records.some((record) => privateAddress(record.address))) throw new Error('Company URL must resolve to a public address.');
  }
  return url;
}

async function safeFetch(start: URL, redirectLimit = 3): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= redirectLimit; hop++) {
    await validateResearchUrl(current.href);
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'TraoInterviewPrep/1.0 (+company research; respects robots.txt)', accept: 'text/html,text/plain,application/xml' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || hop === redirectLimit) return response;
    current = new URL(location, current);
  }
  throw new Error('Too many redirects.');
}

async function readLimited(response: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = BYTE_LIMIT - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      total += Math.max(0, remaining);
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

async function tavilyExtract(url: string): Promise<{ url: string; text: string } | undefined> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return undefined;
  const response = await fetch('https://api.tavily.com/extract', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ urls: url, extract_depth: 'basic', format: 'markdown' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Tavily Extract returned HTTP ${response.status}.`);
  const data = await response.json() as { results?: Array<{ url?: string; raw_content?: string }>; failed_results?: Array<{ url?: string; error?: string }> };
  const result = data.results?.find((item) => item.raw_content?.trim());
  if (!result?.raw_content) {
    const reason = data.failed_results?.[0]?.error;
    throw new Error(reason || 'Tavily Extract returned no page content.');
  }
  return { url: result.url || url, text: result.raw_content.slice(0, 12_000) };
}

async function tavilySearchCompanyPages(root: URL): Promise<Array<{ url: string; text: string }>> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const domain = root.hostname.replace(/^www\./, '');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `site:${domain} company about careers jobs hiring`, search_depth: 'basic', max_results: 5, include_domains: [domain] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Tavily Search returned HTTP ${response.status}.`);
  const data = await response.json() as { results?: Array<{ url?: string; title?: string; content?: string }> };
  return (data.results || []).flatMap((item) => {
    if (!item.url || !item.content) return [];
    try {
      const resultUrl = new URL(item.url);
      if (resultUrl.hostname !== domain && !resultUrl.hostname.endsWith(`.${domain}`)) return [];
      return [{ url: resultUrl.href, text: `${item.title || ''}\n${item.content}`.slice(0, 12_000) }];
    } catch { return []; }
  });
}

function decode(text: string) {
  return text.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function cleanHtml(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]*>/g, ' ').trim();
  const text = decode(html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[\t\r ]+/g, ' ').replace(/\n\s+/g, '\n').trim();
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: decode(m[1]), label: decode(m[2].replace(/<[^>]+>/g, ' ')).trim() }));
  return { title, text: text.slice(0, 12_000), links };
}
function scoreLink(href: string, label: string) {
  const value = `${href} ${label}`.toLowerCase();
  let score = 0;
  if (/career|hiring|job|talent|interview|recruit/.test(value)) score += 5;
  if (/about|company|mission|team|what-we-do/.test(value)) score += 3;
  if (/blog|engineering|culture|handbook/.test(value)) score += 2;
  if (/privacy|terms|login|sign.?in|contact/.test(value)) score -= 5;
  return score;
}

export async function researchCompany(companyUrl: string, onProgress: (message: string) => void = () => undefined): Promise<Research> {
  const gaps: SourceGap[] = [];
  const pages: Research['pages'] = [];
  const root = await validateResearchUrl(companyUrl);
  let robots = '';
  try {
    const response = await safeFetch(new URL('/robots.txt', root));
    if (response.ok) robots = (await readLimited(response)).text.slice(0, 50_000);
  } catch (error) { gaps.push({ source: 'robots.txt', reason: error instanceof Error ? error.message : 'Could not read robots.txt.' }); }
  const disallowed = (url: URL) => {
    const path = `${url.pathname}${url.search}`;
    const active = robots.split(/\r?\n/).reduce<{ applies: boolean; disallow: string[] }[]>((groups, line) => {
      const value = line.split('#')[0].trim();
      if (/^user-agent\s*:/i.test(value)) groups.push({ applies: value.split(':')[1].trim() === '*', disallow: [] });
      else if (/^disallow\s*:/i.test(value) && groups.at(-1)?.applies) groups.at(-1)!.disallow.push(value.split(':').slice(1).join(':').trim());
      return groups;
    }, []);
    return active.flatMap((g) => g.disallow).some((rule) => rule && path.startsWith(rule));
  };
  const queue = [root];
  const seen = new Set<string>();
  while (queue.length && pages.length < PAGE_LIMIT) {
    const next = queue.shift()!;
    const normalized = new URL(next.href); normalized.hash = '';
    if (seen.has(normalized.href)) continue;
    seen.add(normalized.href);
    if (disallowed(normalized)) { gaps.push({ source: normalized.href, reason: 'Blocked by robots.txt.' }); continue; }
    onProgress(`Researching ${normalized.hostname} (${pages.length + 1}/${PAGE_LIMIT})`);
    try {
      const response = await safeFetch(normalized);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const directError = `Page returned HTTP ${response.status}.`;
        if (response.status === 403 && process.env.TAVILY_API_KEY) {
          const fallbackErrors: string[] = [];
          const recovered: Research['pages'] = [];
          try {
            const extracted = await tavilyExtract(normalized.href);
            if (extracted) recovered.push(extracted);
          } catch (error) { fallbackErrors.push(error instanceof Error ? error.message : 'Tavily Extract failed.'); }
          if (normalized.href === root.href) {
            try {
              for (const result of await tavilySearchCompanyPages(root)) {
                if (!recovered.some((page) => page.url === result.url) && recovered.length < PAGE_LIMIT) recovered.push(result);
              }
            } catch (error) { fallbackErrors.push(error instanceof Error ? error.message : 'Tavily Search failed.'); }
          }
          if (recovered.length) {
            for (const page of recovered) if (!pages.some((existing) => existing.url === page.url) && pages.length < PAGE_LIMIT) pages.push(page);
          } else throw new Error(`${directError} Tavily fallback could not recover company content. ${fallbackErrors.join(' ')}`.trim());
          continue;
        }
        throw new Error(directError);
      }
      if (!/text\/html|text\/plain/i.test(contentType)) throw new Error('Skipped: response is not HTML or plain text.');
      const { text: html, truncated } = await readLimited(response);
      const parsed = /html/i.test(contentType) ? cleanHtml(html) : { title: '', text: html.slice(0, 12_000), links: [] };
      const pageUrl = response.url || normalized.href;
      if (truncated && process.env.TAVILY_API_KEY) {
        try {
          const extracted = await tavilyExtract(pageUrl);
          if (extracted) pages.push(extracted);
          else pages.push({ url: pageUrl, text: [parsed.title, parsed.text].filter(Boolean).join('\n').slice(0, 12_000) });
        } catch (error) {
          pages.push({ url: pageUrl, text: [parsed.title, parsed.text].filter(Boolean).join('\n').slice(0, 12_000) });
          gaps.push({ source: normalized.href, reason: `Page exceeded the 500 KB read limit; partial content was used. Tavily extraction failed: ${error instanceof Error ? error.message : 'unknown error'}` });
        }
      } else {
        pages.push({ url: pageUrl, text: [parsed.title, parsed.text].filter(Boolean).join('\n').slice(0, 12_000) });
        if (truncated) gaps.push({ source: normalized.href, reason: 'Page exceeded the 500 KB read limit; partial content was used because Tavily is not configured.' });
      }
      for (const link of parsed.links) {
        try {
          const candidate = new URL(link.href, normalized);
          if (candidate.origin !== root.origin || !['http:', 'https:'].includes(candidate.protocol) || seen.has(candidate.href)) continue;
          if (scoreLink(link.href, link.label) > 0 && !queue.some((item) => item.href === candidate.href)) queue.push(candidate);
        } catch { /* Skip malformed links. */ }
      }
      queue.sort((a, b) => scoreLink(b.pathname, b.pathname) - scoreLink(a.pathname, a.pathname));
    } catch (error) {
      const directError = error instanceof Error ? error.message : 'Could not retrieve page.';
      if (/abort|timeout/i.test(directError) && process.env.TAVILY_API_KEY) {
        try {
          const extracted = await tavilyExtract(normalized.href);
          if (extracted) { pages.push(extracted); continue; }
        } catch (fallbackError) {
          gaps.push({ source: normalized.href, reason: `${directError} Tavily extraction failed: ${fallbackError instanceof Error ? fallbackError.message : 'unknown error'}` });
          continue;
        }
      }
      gaps.push({ source: normalized.href, reason: directError });
    }
  }
  if (!pages.length) gaps.push({ source: companyUrl, reason: 'No company pages could be retrieved.' });
  if (!pages.some((page) => scoreLink(new URL(page.url).pathname, '') >= 3)) gaps.push({ source: 'company about/hiring pages', reason: 'No discoverable about, careers, or hiring page was retrieved.' });
  const host = root.hostname.replace(/^www\./, '').split('.')[0];
  const companyName = pages[0]?.text.split('\n')[0]?.slice(0, 100) || host.charAt(0).toUpperCase() + host.slice(1);
  return { pages, pagesUsed: pages.map((page) => page.url), gaps, companyName };
}

export async function searchDiscussion(company: string): Promise<{ pages: Array<{ url: string; text: string }>; gap?: SourceGap }> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { pages: [], gap: { source: 'public interview discussion search', reason: 'TAVILY_API_KEY is not configured.' } };
  try {
    const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: `${company} interview process interview experience`, search_depth: 'basic', max_results: 5 }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`);
    const data = await response.json() as { results?: Array<{ url?: string; title?: string; content?: string }> };
    return { pages: (data.results || []).slice(0, 5).map((item) => ({ url: item.url || '', text: `${item.title || ''}\n${item.content || ''}`.slice(0, 3000) })).filter((item) => item.url && item.text) };
  } catch (error) { return { pages: [], gap: { source: 'public interview discussion search', reason: error instanceof Error ? error.message : 'Search failed.' } }; }
}
