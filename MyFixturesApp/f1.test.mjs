import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectGames, duration, reconcileEvents, validateConfig } from './living-calendar.mjs';
import { gameMinutes, googleGameUrl } from './calendar-view.mjs';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8').then(text => text.replace("'./living-calendar.mjs'", JSON.stringify(new URL('./living-calendar.mjs', import.meta.url).href)));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const request = (query = '') => new Request(`https://example.test/api/fixtures?sport=f1&dateFrom=2026-01-01&dateTo=2026-12-31${query}`);
const env = { BALLDONTLIE_API_KEY: 'test-key' };
const event = { id: 1, name: 'Italian Grand Prix', start_date: '2026-09-04T10:00:00Z', end_date: '2026-09-06T13:00:00Z', status_state: 'completed', circuit: { name: 'Monza' } };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

test('free Jolpica feed publishes every timed race, qualifying and sprint session', async () => {
  globalThis.fetch = async (input, options) => {
    assert.match(String(input), /api\.jolpi\.ca\/ergast\/f1\/2026\/races/);
    assert.equal(options.headers['User-Agent'], 'MyFixtures/1.0');
    return Response.json({ MRData: { RaceTable: { Races: [{
      season: '2026', round: '17', raceName: 'Singapore Grand Prix', date: '2026-10-11', time: '12:00:00Z', Circuit: { circuitName: 'Marina Bay' },
      Qualifying: { date: '2026-10-10', time: '13:00:00Z' }, Sprint: { date: '2026-10-10', time: '09:00:00Z' },
      SprintQualifying: { date: '2026-10-09', time: '12:30:00Z' }
    }, { season: '2026', round: '18', raceName: 'United States Grand Prix', date: '2026-10-25', time: '20:00:00Z',
      Qualifying: { date: '2026-10-24' } }] } } });
  };
  const response = await worker.fetch(request(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.provider, 'jolpica');
  assert.deepEqual(body.fixtures.slice(0, 4).map(f => f.sessionType), ['sprint-qualifying', 'sprint', 'qualifying', 'race']);
  assert.deepEqual(body.fixtures.slice(0, 4).map(f => f.utcDate), ['2026-10-09T12:30:00Z', '2026-10-10T09:00:00Z', '2026-10-10T13:00:00Z', '2026-10-11T12:00:00Z']);
  assert.equal(body.fixtures.find(f => f.sessionType === 'race').id, 'f1-jolpica-2026-17');
  assert.equal(body.fixtures.find(f => f.title === 'United States Grand Prix - Qualifying').timeTbd, true);
  assert.equal(body.results, 6);
  const narrow = await worker.fetch(new Request('https://example.test/api/fixtures?sport=f1&dateFrom=2026-10-09&dateTo=2026-10-10'), {});
  assert.deepEqual((await narrow.json()).fixtures.map(f => f.sessionType), ['sprint-qualifying', 'sprint', 'qualifying']);
});

test('BALLDONTLIE fallback paginates all supported sessions without practice or canceled entries', async () => {
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    if (url.hostname === 'api.jolpi.ca') return new Response('Unavailable', { status: 502 });
    assert.equal(options.headers.Authorization, 'test-key');
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.searchParams.get('season'), '2026');
      return Response.json({ data: [event], meta: {} });
    }
    assert.equal(url.searchParams.has('type'), false);
    assert.deepEqual(url.searchParams.getAll('event_ids[]'), ['1']);
    const race = { id: 10, event, type: 'Race', date: '2026-09-06T13:00:00Z', status_state: 'scheduled' };
    return Response.json(url.searchParams.has('cursor') ? { data: [
      { ...race, id: 11, type: 'Sprint', date: '2026-09-05T09:00:00Z' },
      { ...race, id: 12, type: 'Qualifying', date: '2026-09-05T13:00:00Z' },
      { ...race, id: 13, type: 'Sprint Qualifying', date: '2026-09-04T12:30:00Z' },
      { ...race, id: 14, type: 'Practice', date: '2026-09-04T10:00:00Z' },
      { ...race, id: 15, status_state: 'canceled' },
      { ...race, id: 16, date: '2027-01-01T12:00:00Z' }
    ], meta: {} } : { data: [race], meta: { next_cursor: 10 } });
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results, 4);
  assert.deepEqual(body.fixtures.map(f => f.sessionType), ['sprint-qualifying', 'sprint', 'qualifying', 'race']);
  assert.equal(body.fixtures[0].title, 'Italian Grand Prix - Sprint Qualifying');
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
    if (String(input).includes('api.jolpi.ca')) return new Response('Unavailable', { status: 502 });
    assert.ok(input.includes('/events?'));
    return Response.json({ data: [], meta: {} });
  };
  assert.equal((await (await worker.fetch(request(), env)).json()).results, 0);
});

test('access errors and non-JSON outages are not cached as empty schedules', async () => {
  globalThis.fetch = async input => String(input).includes('api.jolpi.ca') ? new Response('Unavailable', { status: 502 }) : Response.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await worker.fetch(request(), env);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.match((await denied.json()).error, /ALL-STAR/);
  globalThis.fetch = async () => new Response('Unavailable', { status: 502 });
  assert.equal((await worker.fetch(request(), env)).status, 502);
});

test('F1 session lengths distinguish races, qualifying and sprint events', () => {
  for (const [sessionType, minutes] of [['race', 120], ['qualifying', 60], ['sprint', 45], ['sprint-qualifying', 45]]) {
    assert.equal(duration('f1', sessionType), minutes);
    assert.equal(gameMinutes('f1', sessionType), minutes);
    const url = new URL(googleGameUrl({ sport: 'f1', sessionType, title: 'Singapore Grand Prix', competition: 'Formula 1', utcDate: '2026-10-11T12:00:00Z', venue: 'Marina Bay' }, Date.parse('2026-10-01T00:00:00Z')));
    assert.equal(url.searchParams.get('dates'), `20261011T120000Z/20261011T${String(12 + Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00Z`);
  }
});

test('a Living Calendar exports each F1 session as its own timed event', () => {
  const config = validateConfig({ teams: [{ sport: 'f1', id: 'f1', name: 'Formula 1' }] });
  const fixtures = [
    ['sprint-qualifying', '2026-10-09T12:30:00Z'],
    ['sprint', '2026-10-10T09:00:00Z'],
    ['qualifying', '2026-10-10T13:00:00Z'],
    ['race', '2026-10-11T12:00:00Z']
  ].map(([sessionType, utcDate]) => ({ id: `f1-jolpica-2026-17-${sessionType}`, sport: 'f1', sessionType, utcDate,
    opponent: 'Singapore Grand Prix', title: `Singapore Grand Prix - ${sessionType}`, competition: 'Formula 1', status: 'scheduled', provider: 'jolpica' }));
  const games = collectGames(config, { 'f1:f1': { fixtures } });
  const events = Object.values(reconcileEvents({}, games, config, Date.parse('2026-10-01T00:00:00Z')));
  assert.equal(games.length, 4);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => (Date.parse(event.end) - Date.parse(event.start)) / 60000).sort((a, b) => a - b), [45, 45, 60, 120]);
});
