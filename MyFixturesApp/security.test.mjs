import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const workerModule = await import(`data:text/javascript;base64,${Buffer.from(workerSource.replace("'./living-calendar.mjs'", JSON.stringify(new URL('./living-calendar.mjs', import.meta.url).href)) + '\nexport { withApiCache, getNbaPages, getMlbPages, getF1Pages };').toString('base64')}`);

test('HTTPS redirect and security headers cover static pages and API errors', async () => {
  const worker = workerModule.default;
  const env = { ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) } };
  const redirect = await worker.fetch(new Request('http://example.test/fixtures?team=1'), env);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://example.test/fixtures?team=1');
  const page = await worker.fetch(new Request('https://example.test/'), env);
  assert.equal(page.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const invalid = await worker.fetch(new Request('https://example.test/api/teams?sport=unknown'), env);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('x-frame-options'), 'DENY');
});

test('only declared public assets can be fetched from the asset binding', async () => {
  let assetFetches = 0;
  const env = { ASSETS: { fetch: async () => { assetFetches++; return new Response('asset'); } } };
  const publicPaths = ['/', '/index.html', '/calendar', '/calendar.html', '/app.js', '/calendar-ui.mjs', '/calendar-view.mjs', '/calendar-guides.mjs', '/schedule-common.mjs', '/app.css'];
  for (const path of publicPaths) assert.equal((await workerModule.default.fetch(new Request(`https://example.test${path}`), env)).status, 200, path);
  for (const path of ['/.gitignore', '/.dev.vars', '/package.json', '/worker.js', '/.wrangler/security-dry-run/worker.js.map']) {
    assert.equal((await workerModule.default.fetch(new Request(`https://example.test${path}`), env)).status, 404, path);
  }
  assert.equal((await workerModule.default.fetch(new Request('https://example.test/', { method: 'POST' }), env)).status, 405);
  assert.equal(assetFetches, publicPaths.length);
});

test('calendar write route remains available behind the shared security wrapper', async () => {
  let forwarded = false;
  const env = { CALENDARS: { idFromName: name => name, get: () => ({ fetch: async () => { forwarded = true; return Response.json({ id: 'saved' }, { status: 201 }); } }) } };
  const response = await workerModule.default.fetch(new Request('https://example.test/api/calendars', { method: 'POST', headers: { origin: 'https://example.test' }, body: '{}' }), env);
  assert.equal(response.status, 201);
  assert.equal(forwarded, true);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('API input bounds and duplicate query keys reject invalid requests', async () => {
  const worker = workerModule.default;
  for (const query of ['sport=unknown', 'sport=nhl&sport=nba', 'sport=nhl&search=x&search=y', 'sport=mlb&dateFrom=2026-02-30', 'sport=mlb&dateFrom=2026-10-01&dateTo=2026-09-01', 'sport=soccer&dateFrom=2026-01-01&dateTo=2030-01-01', 'sport=nfl&teamAbbreviation=../bad', `sport=nba&search=${'x'.repeat(81)}`]) {
    const response = await worker.fetch(new Request(`https://example.test/api/teams?${query}`), {});
    assert.equal(response.status, 400, query);
  }
});

test('provider pagination has a finite page budget', async () => {
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  let page = 0;
  globalThis.fetch = async () => Response.json({ data: [], meta: { next_cursor: String(++page) } });
  const env = { BALLDONTLIE_API_KEY: 'test-only' };
  for (const [loader, args] of [
    [workerModule.getNbaPages, ['games', new URLSearchParams(), env]],
    [workerModule.getMlbPages, [new URLSearchParams(), env]],
    [workerModule.getF1Pages, ['events', new URLSearchParams(), env]]
  ]) {
    page = 0;
    await assert.rejects(loader(...args), /too many pages/);
    assert.equal(page, 25);
  }
});

test('asset upload rules exclude local secret material', async () => {
  const ignores = await readFile(new URL('./.assetsignore', import.meta.url), 'utf8');
  for (const pattern of ['.dev.vars*', '.env', '.env.*', '.wrangler/', '*.pem', '*.key']) assert.ok(ignores.split(/\r?\n/).includes(pattern), pattern);
});

test('cache noise cannot evade miss limiter; cached API response remains available', async () => {
  const entries = new Map();
  globalThis.caches = { default: { match: async key => entries.get(key.url)?.clone(), put: async (key, response) => entries.set(key.url, response.clone()) } };
  let calls = 0;
  const env = { PUBLIC_API_RATE_LIMIT: { limit: async () => ({ success: ++calls === 1 }) } };
  const request = suffix => new Request(`https://example.test/api/teams?sport=nhl&search=Boston&${suffix}`, { headers: { 'cf-connecting-ip': '192.0.2.1' } });
  const first = await workerModule.withApiCache(request('release=one'), env, 3600, () => Response.json([{ name: 'Boston' }]));
  assert.equal(first.status, 200);
  const hit = await workerModule.withApiCache(request('_=999&release=two'), env, 3600, () => { throw new Error('cache miss'); });
  assert.equal(hit.headers.get('x-myfixtures-cache'), 'HIT');
  assert.equal(calls, 1);
  const limited = await workerModule.withApiCache(request('search=Boston&v=3'), env, 3600, () => Response.json([]));
  assert.equal(limited.status, 200); // Same semantic query is served from cache.
  const other = new Request('https://example.test/api/teams?sport=nhl&search=Toronto', { headers: { 'cf-connecting-ip': '192.0.2.1' } });
  assert.equal((await workerModule.withApiCache(other, env, 3600, () => Response.json([]))).status, 429);
});

test('team names, logos, ids and errors are encoded at browser HTML sinks', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const snippet = source.slice(source.indexOf('function teamInitials('), source.indexOf('function fixtureTitle(')) + '\n' + source.slice(source.indexOf('function readSavedClubs('), source.indexOf('async function selectTeam('));
  const team = { id: 'a" onclick="alert(1)', sport: 'soccer', name: '<img src=x onerror=alert(1)>', crest: 'https://example.test/x" onerror="alert(1)' };
  const savedClubs = { innerHTML: '', querySelectorAll: () => [] };
  const clubResults = { innerHTML: '', querySelectorAll: () => [] };
  const context = vm.createContext({ currentSport: 'soccer', savedClubs, clubResults, clubSearchInput: { value: 'test' }, localStorage: { getItem: () => JSON.stringify([team]) }, sportLabel: () => 'Soccer', fetch: async () => Response.json([team]), console });
  vm.runInContext(snippet, context);
  const mark = vm.runInContext('teamMark(' + JSON.stringify(team) + ')', context);
  assert.match(mark, /&quot; onerror=/);
  assert.doesNotMatch(mark, /" onerror=/);
  vm.runInContext('renderSavedClubs()', context);
  assert.match(savedClubs.innerHTML, /&lt;img/);
  assert.match(savedClubs.innerHTML, /a&quot; onclick=/);
  await vm.runInContext('searchTeams({ preventDefault() {} })', context);
  assert.match(clubResults.innerHTML, /&lt;img/);
  assert.match(clubResults.innerHTML, /a&quot; onclick=/);
  context.fetch = async () => ({ ok: false, json: async () => ({ error: '<svg onload=alert(1)>' }) });
  await vm.runInContext('searchTeams({ preventDefault() {} })', context);
  assert.match(clubResults.innerHTML, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(vm.runInContext('teamMark({ name: "Beyoncé", crest: "https://example.test/logo.png" })', context), /src="https:\/\/example.test\/logo.png"/);
  assert.match(vm.runInContext('teamMark({ name: "<svg>", crest: "javascript:alert(1)" })', context), /&lt;/);
});
