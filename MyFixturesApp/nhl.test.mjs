import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const flyers = { id: 4, abbrev: 'PHI', name: { default: 'Philadelphia Flyers' }, placeName: { default: 'Philadelphia' }, commonName: { default: 'Flyers' }, logo: 'https://assets.nhle.com/logos/nhl/svg/PHI_light.svg' };
const habs = { id: 8, abbrev: 'MTL', name: { default: 'Montréal Canadiens' }, placeName: { default: 'Montréal' }, commonName: { default: 'Canadiens' } };
const game = (id, overrides = {}) => ({ id, season: 20992100, gameType: 2, gameDate: '2099-10-20', startTimeUTC: '2099-10-21T02:00:00Z', gameState: 'FUT', gameScheduleState: 'OK', homeTeam: flyers, awayTeam: habs, venue: { default: 'Test Arena' }, ...overrides });
const request = (query = 'team=4&dateFrom=2099-07-01&dateTo=2100-06-30') => new Request(`https://example.test/api/fixtures?sport=nhl&${query}`);
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
function mockGames(games) {
  globalThis.fetch = async (input, options) => {
    assert.ok(options.signal, 'provider requests have a timeout');
    const url = new URL(input);
    assert.equal(url.hostname, 'api-web.nhle.com');
    if (url.pathname === '/v1/schedule-calendar/now') return Response.json({ teams: [flyers, habs] });
    assert.equal(url.pathname, '/v1/club-schedule-season/PHI/20992100');
    return Response.json({ games });
  };
}

test('NHL keyless team search accepts unaccented names and abbreviations', async () => {
  mockGames([]);
  for (const search of ['montreal', 'MTL']) {
    const response = await worker.fetch(new Request(`https://example.test/api/teams?sport=nhl&search=${search}`), {});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map(t => t.id), [8]);
  }
  const teams = await (await worker.fetch(new Request('https://example.test/api/teams?sport=nhl'), {})).json();
  assert.equal(teams.length, 2);
  assert.equal(teams.find(t => t.id === 4).crest, flyers.logo);
});

test('NHL retains entire season, split-squad games and playoffs with exact source dates/venues', async () => {
  mockGames([game(1, { gameType: 1 }), game(2, { gameType: 1 }), game(3), game(3),
    game(4, { gameType: 3, homeTeam: habs, awayTeam: flyers, neutralSite: true }),
    game(5, { season: 20982199 }), game(6, { gameScheduleState: 'CNCL' }), game(7, { gameType: 4 })]);
  const response = await worker.fetch(request(), {});
  assert.equal(response.status, 200);
  const { fixtures } = await response.json();
  assert.equal(fixtures.length, 4);
  assert.equal(fixtures.filter(f => f.seasonType === 'preseason').length, 2);
  assert.ok(fixtures.every(f => f.utcDate === '2099-10-21T02:00:00Z' && f.scheduledDate === '2099-10-20' && f.venue === 'Test Arena' && !f.timeTbd));
  const playoff = fixtures.find(f => f.postseason);
  assert.equal(playoff.home, false);
  assert.equal(playoff.neutralSite, true);
  assert.equal(playoff.opponent, 'Montréal Canadiens');
  assert.equal(playoff.competition, 'NHL Stanley Cup Playoffs');
});

test('NHL date filtering uses scheduled local date, not next-day UTC; January uses previous season year', async () => {
  mockGames([game(1), game(2, { gameDate: '2099-10-21' })]);
  const data = await (await worker.fetch(request('team=4&dateFrom=2099-10-20&dateTo=2099-10-20'), {})).json();
  assert.deepEqual(data.fixtures.map(f => f.id), ['nhl-1']);
  mockGames([game(3, { gameDate: '2100-01-02', startTimeUTC: '2100-01-03T02:00:00Z' })]);
  const january = await (await worker.fetch(request('team=4&dateFrom=2100-01-01&dateTo=2100-06-30'), {})).json();
  assert.equal(january.season, '20992100');
  assert.equal(january.results, 1);
});

test('NHL unknown/postponed times stay TBD while completed games remain in season', async () => {
  mockGames([game(1, { startTimeUTC: null }), game(2, { gameScheduleState: 'TBD' }), game(3, { gameScheduleState: 'PPD' }), game(4, { gameState: 'OFF' }), game(5, { startTimeUTC: 'invalid' })]);
  const data = await (await worker.fetch(request(), {})).json();
  assert.equal(data.results, 5);
  assert.equal(data.fixtures.filter(f => f.timeTbd).length, 4);
  assert.equal(data.fixtures.find(f => f.id === 'nhl-1').utcDate, '2099-10-20T12:00:00Z');
  assert.equal(data.fixtures.find(f => f.id === 'nhl-4').timeTbd, false);
});

test('NHL validates requests and never caches provider failures or malformed schedules as successful API results', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected request'); };
  for (const query of ['team=abc', 'team=0', 'team=4&dateFrom=2099-02-30', 'team=4&dateFrom=2099-07-01&dateTo=2101-01-01', 'team=4&dateFrom=2099-10-02&dateTo=2099-10-01']) assert.equal((await worker.fetch(request(query), {})).status, 400);
  assert.equal(calls, 0);
  mockGames([]);
  assert.equal((await worker.fetch(request('team=999'), {})).status, 404);
  for (const status of [429, 503]) {
    globalThis.fetch = async () => new Response('Unavailable', { status });
    const response = await worker.fetch(request(), {});
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  globalThis.fetch = async () => Response.json({ unexpected: [] });
  assert.equal((await worker.fetch(request(), {})).status, 502);
  mockGames([game(1, { gameDate: '2099-02-30' })]);
  assert.equal((await worker.fetch(request(), {})).status, 502);
  mockGames([]);
  assert.equal((await (await worker.fetch(request(), {})).json()).results, 0);
});

test('NHL UI renders individual games, accurate timezone dates and all confirmed calendar exports', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', value: '', options: [{ text: 'Eastern Time' }], selectedIndex: 0,
      addEventListener() {}, querySelectorAll: () => [], click() {}, close() {} });
    return elements.get(selector);
  };
  const games = Array.from({ length: 84 }, (_, index) => ({ id: `nhl-${index}`, sport: 'nhl', utcDate: '2099-10-21T02:00:00Z', scheduledDate: '2099-10-20', opponent: 'Same Opponent', competition: 'NHL Regular Season', venue: 'Arena', home: false, timeTbd: false }));
  games.push({ ...games[0], id: 'nhl-tbd', scheduledDate: '2099-10-22', timeTbd: true });
  let downloaded;
  const posted = [];
  const context = vm.createContext({ console, Intl, Date, URLSearchParams, Blob, setTimeout,
    URL: { createObjectURL(blob) { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    localStorage: { getItem: key => key === 'fixture-sport' ? 'nhl' : null, setItem() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('a') }, window: {},
    fetch: async (url, options) => {
      if (options?.method === 'POST') { posted.push(JSON.parse(options.body)); return { ok: true }; }
      assert.match(url, /sport=nhl&team=4/);
      return { ok: true, json: async () => ({ fixtures: games, provider: 'nhl' }) };
    }
  });
  vm.runInContext(app, context);
  await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(element('#fixture-list').innerHTML.match(/<article class="fixture/g).length, 85);
  assert.match(element('.hero-copy h1').innerHTML, /puck drop/);
  assert.match(element('#source-note').innerHTML, /nhl.com/);
  assert.equal(element('#fixture-time-label').textContent, 'Puck drop');
  const event = vm.runInContext('googleCalendarEvent(fixtures[0])', context);
  assert.equal(event.start.dateTime, '2099-10-20T22:00:00');
  assert.equal(event.end.dateTime, '2099-10-21T00:30:00');
  vm.runInContext('downloadCalendar(fixtures)', context);
  const ics = await downloaded.text();
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 84);
  assert.equal(new Set(ics.match(/UID:.+/g)).size, 84, 'same-day games must have unique calendar IDs');
  for (const [zone, expected] of [['America/Los_Angeles', '2099-10-20T19:00:00'], ['Asia/Tokyo', '2099-10-21T11:00:00']]) {
    vm.runInContext(`selectedTimeZone = '${zone}'`, context);
    assert.equal(vm.runInContext('googleCalendarEvent(fixtures[0]).start.dateTime', context), expected);
    assert.equal(vm.runInContext('fixtureDateKey(fixtures.at(-1))', context), '2099-10-22');
  }
  vm.runInContext(`selectedTimeZone = 'America/New_York'`, context);
  // DST conversion must use each game's date, not today's offset.
  assert.equal(vm.runInContext(`formatFixtureForSelectedZone('2026-11-02T00:00:00Z').time`, context), '19:00');
  assert.equal(vm.runInContext(`formatFixtureForSelectedZone('2026-10-30T00:00:00Z').time`, context), '20:00');
  vm.runInContext('getGoogleAccessToken = async () => "test-token"', context);
  await vm.runInContext('addAllToGoogleCalendar()', context);
  assert.equal(posted.length, 84);
  assert.ok(posted.every(event => event.summary.includes('Philadelphia Flyers')));
  // A slower previous selection must never replace a newer team's schedule.
  vm.runInContext('pendingLoads = []; fetch = () => new Promise(resolve => pendingLoads.push(resolve)); firstLoad = loadLiveFixtures(); currentTeam = { id: 8, sport: "nhl", name: "Montréal Canadiens" }; secondLoad = loadLiveFixtures();', context);
  vm.runInContext('pendingLoads[1]({ ok: true, json: async () => ({ fixtures: [], provider: "nhl" }) })', context);
  await vm.runInContext('secondLoad', context);
  vm.runInContext('pendingLoads[0]({ ok: true, json: async () => ({ fixtures: [{ id: "wrong-team" }], provider: "nhl" }) })', context);
  await vm.runInContext('firstLoad', context);
  assert.equal(vm.runInContext('fixtures.length', context), 0);
  assert.match(element('#source-note').textContent, /No NHL games/);
});
