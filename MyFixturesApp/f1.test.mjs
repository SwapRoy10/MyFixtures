import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8').then(text => text.replace("'./living-calendar.mjs'", JSON.stringify(new URL('./living-calendar.mjs', import.meta.url).href)));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const request = (query = '') => new Request(`https://example.test/api/fixtures?sport=f1&dateFrom=2026-01-01&dateTo=2026-12-31${query}`);
const env = { BALLDONTLIE_API_KEY: 'test-key' };
  const event = { id: 1, name: 'Italian Grand Prix', start_date: '2026-09-04T10:00:00Z', end_date: '2026-09-06T13:00:00Z', status_state: 'completed', circuit: { name: 'Monza' } };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

test('F1 schedule paginates, authenticates, filters and normalizes races', async () => {
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.headers.Authorization, 'test-key');
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.searchParams.get('season'), '2026');
      return Response.json({ data: [event], meta: {} });
    }
    assert.equal(url.searchParams.get('type'), 'Race');
    assert.deepEqual(url.searchParams.getAll('event_ids[]'), ['1']);
    const race = { id: 10, event, type: 'Race', date: '2026-09-06T13:00:00Z', status_state: 'scheduled' };
    return Response.json(url.searchParams.has('cursor') ? { data: [race, { ...race, id: 11, status_state: 'canceled' }, { ...race, id: 12, date: '2027-01-01T12:00:00Z' }], meta: {} } : { data: [race], meta: { next_cursor: 10 } });
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results, 1);
  assert.equal(body.fixtures[0].title, 'Italian Grand Prix - Race');
  assert.equal(body.fixtures[0].venue, 'Monza');
  assert.equal(calls.length, 4);
});

test('missing key and invalid date ranges fail before provider requests', async () => {
  globalThis.fetch = async () => { throw new Error('Must not fetch'); };
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/api/fixtures?sport=f1&dateFrom=2026-02-30'), env)).status, 400);
});

test('empty season never issues an unfiltered sessions request', async () => {
  globalThis.fetch = async input => {
    assert.ok(input.includes('/events?'));
    return Response.json({ data: [], meta: {} });
  };
  assert.equal((await (await worker.fetch(request(), env)).json()).results, 0);
});

test('access errors and non-JSON outages are not cached as empty schedules', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await worker.fetch(request(), env);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.match((await denied.json()).error, /ALL-STAR/);
  globalThis.fetch = async () => new Response('Unavailable', { status: 502 });
  assert.equal((await worker.fetch(request(), env)).status, 502);
});
