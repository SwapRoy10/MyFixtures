import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8').then(text => text.replace("'./living-calendar.mjs'", JSON.stringify(new URL('./living-calendar.mjs', import.meta.url).href)));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const env = { BALLDONTLIE_API_KEY: 'test-key' };
const sixers = { id: 23, full_name: 'Philadelphia 76ers', abbreviation: 'PHI', conference: 'East', division: 'Atlantic' };
const knicks = { id: 20, full_name: 'New York Knicks', abbreviation: 'NYK', conference: 'East', division: 'Atlantic' };
const game = (id, overrides = {}) => ({ id, date: '2099-10-20', datetime: '2099-10-20T23:00:00Z', season: 2099, status: '7:00 pm ET', status_state: 'scheduled', home_team: knicks, visitor_team: sixers, ...overrides });
const request = (query = '') => new Request(`https://example.test/api/fixtures?sport=nba&team=23&dateFrom=2099-07-01&dateTo=2100-06-30${query}`);
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

test('NBA search lists current teams, filters names/abbreviations, and maps logos', async () => {
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(input).pathname, '/v1/teams');
    assert.equal(options.headers.Authorization, 'test-key');
    return Response.json({ data: [sixers, knicks, { id: 99, full_name: 'Historical Knicks', conference: '', division: '' }] });
  };
  const response = await worker.fetch(new Request('https://example.test/api/teams?sport=nba&search=nyk'), env);
  const teams = await response.json();
  assert.equal(response.status, 200);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].name, 'New York Knicks');
  assert.equal(teams[0].crest, 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png');
  const all = await (await worker.fetch(new Request('https://example.test/api/teams?sport=nba'), env)).json();
  assert.equal(all.length, 2);
});

test('NBA loads every page plus preseason, deduplicates, labels Cup/playoffs and enriches venues', async () => {
  const pages = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname.includes('espn')) return Response.json({ events: [{ date: '2099-10-20T23:00Z', competitions: [{ venue: { fullName: 'Madison Square Garden' }, competitors: [
      { homeAway: 'home', team: { abbreviation: 'NY' } }, { homeAway: 'away', team: { abbreviation: 'PHI' } }
    ] }] }] });
    assert.equal(options.headers.Authorization, 'test-key');
    assert.equal(url.searchParams.get('seasons[]'), '2099');
    assert.equal(url.searchParams.get('team_ids[]'), '23');
    assert.equal(url.searchParams.get('start_date'), '2099-07-01');
    assert.equal(url.searchParams.get('end_date'), '2100-06-30');
    assert.equal(url.searchParams.get('per_page'), '100');
    pages.push(url.search);
    if (url.searchParams.get('season_type') === 'preseason') return Response.json({ data: [game(4, { date: '2099-10-01', datetime: '2099-10-01T23:00Z' })] });
    if (!url.searchParams.has('cursor')) return Response.json({ data: [game(1), game(2, { ist_stage: 'East Group A', date: '2099-11-01', datetime: '2099-11-02T00:00Z' })], meta: { next_cursor: 123 } });
    assert.equal(url.searchParams.get('cursor'), '123');
    return Response.json({ data: [game(1), game(3, { date: '2100-04-20', datetime: '2100-04-21T00:00Z', postseason: true }), game(5, { status_state: 'canceled' }), game(6, { visitor_team: knicks }), game(7, { date: '2098-10-20' })] });
  };
  const response = await worker.fetch(request(), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(pages.length, 3);
  assert.deepEqual(data.fixtures.map(f => f.id), ['nba-4', 'nba-1', 'nba-2', 'nba-3']);
  assert.deepEqual(data.fixtures.map(f => f.competition), ['NBA Preseason', 'NBA Regular Season', 'NBA Cup - East Group A', 'NBA Playoffs']);
  assert.equal(data.fixtures[1].venue, 'Madison Square Garden');
  assert.equal(data.fixtures[1].home, false);
  assert.equal(data.fixtures[1].utcDate, '2099-10-20T23:00:00Z');
  assert.equal(data.fixtures[1].timeTbd, false);
});

test('NBA preserves dates with missing times, postponed games, and completed season records', async () => {
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname.includes('espn')) throw new Error('Optional venue feed unavailable');
    if (url.searchParams.has('season_type')) return Response.json({ data: [] });
    return Response.json({ data: [game(1, { datetime: null }), game(2, { postponed: true }), game(3, { status_state: 'final', status: 'Final' }), game(4, { datetime: 'invalid', status: 'TBD' })] });
  };
  const data = await (await worker.fetch(request(), env)).json();
  assert.equal(data.results, 4);
  assert.equal(data.fixtures.find(f => f.id === 'nba-1').scheduledDate, '2099-10-20');
  assert.equal(data.fixtures.filter(f => f.timeTbd).length, 3);
  assert.equal(data.fixtures.find(f => f.id === 'nba-3').status, 'final');
});

test('NBA invalid requests, provider failures and repeated cursors never become cached partial schedules', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected request'); };
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/api/fixtures?sport=nba&team=23&dateFrom=2026-02-30&dateTo=2027-06-30'), env)).status, 400);
  assert.equal(calls, 0);
  for (const status of [401, 429, 502]) {
    globalThis.fetch = async () => new Response('Unavailable', { status });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  globalThis.fetch = async input => new URL(input).searchParams.has('season_type') ? new Response('Rate limited', { status: 429 }) : Response.json({ data: [game(1)] });
  assert.equal((await worker.fetch(request(), env)).status, 429);
  globalThis.fetch = async () => Response.json({ data: [game(1)], meta: { next_cursor: 1 } });
  assert.equal((await worker.fetch(request(), env)).status, 502);
});

test('NBA UI renders individual games and exports all confirmed games across timezone/date boundaries', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', value: '', options: [{ text: 'Eastern Time' }], selectedIndex: 0,
      addEventListener() {}, querySelectorAll: () => [], click() {} });
    return elements.get(selector);
  };
  const fixtures = Array.from({ length: 80 }, (_, index) => ({ id: `nba-${index}`, sport: 'nba', utcDate: `2099-10-21T00:00:00Z`, opponent: `Opponent ${index}`, competition: 'NBA Regular Season', venue: 'Arena', home: false, timeTbd: false }));
  fixtures.push({ id: 'nba-tbd', sport: 'nba', utcDate: '2099-10-22T12:00Z', scheduledDate: '2099-10-22', timeTbd: true, opponent: 'TBD opponent', competition: 'NBA Regular Season', home: true });
  let downloaded;
  const posted = [];
  const context = vm.createContext({ console, Intl, Date, URLSearchParams, Blob, setTimeout,
    URL: { createObjectURL(blob) { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    localStorage: { getItem: key => key === 'fixture-sport' ? 'nba' : null, setItem() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('a') },
    window: {},
    fetch: async (url, options) => {
      if (options?.method === 'POST') { posted.push(JSON.parse(options.body)); return { ok: true }; }
      assert.match(url, /sport=nba&team=23/);
      return { ok: true, json: async () => ({ fixtures, provider: 'balldontlie' }) };
    }
  });
  vm.runInContext(app, context);
  await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(element('#fixture-list').innerHTML.match(/<article class="fixture/g).length, 81);
  assert.match(element('#fixture-list').innerHTML, /class="month-divider"/);
  assert.match(element('#pulse-count').textContent, /^\d+d \d{2}h$/);
  assert.equal(element('#pulse-fixtures').textContent, '81 fixtures in this season view');
  assert.match(element('#pulse-next').textContent, /Next confirmed: Opponent 0/);
  assert.equal(element('#fixture-list').innerHTML.includes('series-tab'), false);
  vm.runInContext("activeFixtureFilter = 'home'; render()", context);
  assert.equal(element('#fixture-list').innerHTML.match(/<article class="fixture/g).length, 1);
  assert.equal(element('#fixture-count').textContent, '1 game in this view');
  assert.equal(element('#pulse-fixtures').textContent, '81 fixtures in this season view');
  vm.runInContext('downloadCalendar(fixtures)', context);
  assert.equal((await downloaded.text()).match(/BEGIN:VEVENT/g).length, 80);
  vm.runInContext("activeFixtureFilter = 'all'; render()", context);
  assert.equal(element('.hero-copy h1').innerHTML.includes('tipoff'), true);
  const event = vm.runInContext('googleCalendarEvent(fixtures[0])', context);
  assert.equal(event.start.dateTime, '2099-10-20T20:00:00');
  assert.equal(event.end.dateTime, '2099-10-20T22:30:00');
  vm.runInContext('downloadCalendar(fixtures)', context);
  assert.equal((await downloaded.text()).match(/BEGIN:VEVENT/g).length, 80);
  assert.equal(vm.runInContext('fixtureDateKey(fixtures.at(-1))', context), '2099-10-22');
  vm.runInContext('getGoogleAccessToken = async () => { currentTeam = { name: "Other Team" }; selectedTimeZone = "America/Los_Angeles"; return "fake-token"; };', context);
  await vm.runInContext('addAllToGoogleCalendar()', context);
  assert.equal(posted.length, 80);
  assert.ok(posted.every(event => event.summary.includes('Philadelphia 76ers')));
  assert.ok(posted.every(event => event.start.timeZone === 'America/New_York'));
  const calendarId = 'a'.repeat(32);
  const today = vm.runInContext('selectedZoneDateKey()', context);
  const followedGames = ['soccer', 'nba', 'mlb'].map((sport, index) => ({ sport, title: `${sport} followed game`, utcDate: `${today}T${18 + index}:00:00Z`, timeTbd: false }));
  const oldGetItem = context.localStorage.getItem;
  let savedSlate;
  context.localStorage.getItem = key => key === 'living-calendar-owner' ? JSON.stringify({ id: calendarId }) : key === `myweek-slate:${calendarId}` ? savedSlate : oldGetItem(key);
  context.localStorage.setItem = (key, value) => { if (key === `myweek-slate:${calendarId}`) savedSlate = value; };
  context.fetch = async url => { assert.equal(url, `/api/calendars/${calendarId}`); return { ok: true, json: async () => ({ ready: true, games: followedGames, config: { teams: [{ id: 1 }, { id: 2 }] } }) }; };
  await vm.runInContext('loadFollowedSlate()', context);
  assert.equal(element('#slate-grid').innerHTML.match(/class="slate-game"/g).length, 3);
  assert.match(element('#slate-source').textContent, /All 2 followed teams/);
  vm.runInContext("currentSport = 'soccer'; renderSevenDaySlate()", context);
  assert.equal(element('#slate-grid').innerHTML.match(/class="slate-game"/g).length, 3);
  context.fetch = async () => { throw new Error('provider offline'); };
  vm.runInContext('followedSlate = null', context);
  await vm.runInContext('loadFollowedSlate()', context);
  assert.match(element('#slate-source').textContent, /last saved slate/);
  assert.equal(element('#slate-grid').innerHTML.match(/class="slate-game"/g).length, 3);
});
