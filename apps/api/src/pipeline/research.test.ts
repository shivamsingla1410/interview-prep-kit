import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { researchCompany } from './research.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockResearchFetch(t: TestContext, companyResponse: () => Response | Promise<Response>, extractText = 'Tavily company content') {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.TAVILY_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.TAVILY_API_KEY = 'test-tavily-key';
  process.env.NODE_ENV = 'test';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.tavily.com' && url.pathname === '/extract') {
      return json({ results: [{ url: 'https://example.test/about', raw_content: extractText }] });
    }
    if (url.hostname === 'api.tavily.com' && url.pathname === '/search') {
      return json({ results: [{ url: 'https://example.test/about', title: 'About', content: 'Company overview' }] });
    }
    if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
    return companyResponse();
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalApiKey;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });
}

test('a company page recovered from HTTP 403 is not reported as a research gap', async (t) => {
  mockResearchFetch(t, () => new Response('', { status: 403 }));
  const result = await researchCompany('https://example.test/');
  assert.ok(result.pages.some((page) => page.text.includes('Tavily company content')));
  assert.ok(!result.gaps.some((gap) => gap.reason.includes('HTTP 403')));
  assert.ok(!result.gaps.some((gap) => gap.reason.includes('No company pages could be retrieved')));
});

test('an oversized company page uses Tavily extraction instead of partial HTML when available', async (t) => {
  mockResearchFetch(t, () => new Response('x'.repeat(500_001), { headers: { 'content-type': 'text/html' } }));
  const result = await researchCompany('https://example.test/');
  assert.ok(result.pages.some((page) => page.text === 'Tavily company content'));
  assert.ok(!result.gaps.some((gap) => gap.reason.includes('500 KB')));
});

test('a timed-out company page falls back to Tavily extraction', async (t) => {
  mockResearchFetch(t, () => { throw new Error('The operation was aborted due to timeout'); });
  const result = await researchCompany('https://example.test/');
  assert.ok(result.pages.some((page) => page.text.includes('Tavily company content')));
  assert.ok(!result.gaps.some((gap) => gap.reason.includes('timeout')));
});
