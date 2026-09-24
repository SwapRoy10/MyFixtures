import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateConfig, included, collectGames, reconcileEvents, calendarText, seasonRange, scheduleChanges, teamHealth, LivingCalendarStore } from './living-calendar.mjs';
import { competitionKey, confirmedOpponent, matchesPreferences } from './schedule-common.mjs';
import { groupWeekSeries, describeChange, googleGameUrl } from './calendar-view.mjs';
import { calendarGuides } from './calendar-guides.mjs';
const now = Date.parse('2026-09-24T12:00:00Z');
const team = { sport: 'mlb', id: 19, name: 'New York Yankees', abbreviation: 'NYY' };
const game = (id = 'one', extra = {}) => ({ id, key: `mlb:${id}`, sport: 'mlb', utcDate: '2026-09-26T23:00:00Z', scheduledDate: '2026-09-26', home: true, homeName: team.name, awayName: 'Boston Red Sox', opponent: 'Boston Red Sox', title: 'New York Yankees v Boston Red Sox', venue: 'Yankee Stadium', competition: 'MLB', provider: 'balldontlie', timeTbd: false, selectedTeams: ['mlb:19'], selectedSides: ['home'], ...extra });
const config = (extra = {}) => validateConfig({ teams: [team], includeCompleted: true, ...extra });
class Storage {
  data = new Map(); alarm = null;
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { for (const [k, v] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) this.data.set(k, structuredClone(v)); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix }) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, structuredClone(v)])); }
  async transaction(fn) { return fn(this); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
}
function harness(t, loader) {
  let time = now; t.mock.method(Date, 'now', () => time);
  const storage = new Storage(), ctx = { storage, blockConcurrencyWhile: fn => fn() };
  const store = new LivingCalendarStore(ctx, {}, loader);
  const request = (path, method = 'GET', body, token) => store.fetch(new Request(`https://test${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { store, storage, ctx, request, setTime: value => { time = value; } };
}

test('Advanced settings validate dates, modes and competition inputs; legacy calendars get safe defaults', () => {
  const defaults = config();
  assert.equal(defaults.venueFilter, 'all'); assert.deepEqual(defaults.competitionFilters, []); assert.equal(defaults.dateFrom, '');
  for (const invalid of [{ venueFilter: 'neutral' }, { dateFrom: '2026-02-30' }, { dateFrom: '2026-10-01', dateTo: '2026-09-01' }, { competitionFilters: ['invalid'] }, { competitionFilters: Array(51).fill('mlb:mlb') }]) assert.throws(() => config(invalid));
  assert.equal(config({ dateFrom: '2028-02-29', competitionFilters: ['mlb:mlb', 'mlb:mlb'] }).competitionFilters.length, 1);
});

test('Home/away applies to any selected team without duplicating head-to-head games; neutral/F1 rules', () => {
  const other = { sport: 'mlb', id: 2, name: 'Boston Red Sox' };
  const cfg = config({ teams: [team, other], venueFilter: 'away' });
  const games = collectGames(cfg, { 'mlb:19': { fixtures: [game()] }, 'mlb:2': { fixtures: [game('one', { home: false, opponent: team.name })] } });
  assert.equal(games.length, 1); assert.deepEqual(games[0].selectedSides, ['home', 'away']);
  assert.equal(included(games[0], cfg, now), true);
  assert.equal(included(game(), cfg, now), false);
  assert.equal(included({ ...games[0], neutralSite: true }, cfg, now), false);
  assert.equal(matchesPreferences(game('race', { sport: 'f1' }), cfg), true);
});

test('Date filters use viewer local dates, include both boundaries and preserve provisional dates', () => {
  const cfg = config({ timeZone: 'America/Los_Angeles', dateFrom: '2026-09-26', dateTo: '2026-09-26' });
  assert.equal(included(game('late', { utcDate: '2026-09-27T02:00:00Z' }), cfg, now), true);
  assert.equal(included(game('early', { utcDate: '2026-09-26T02:00:00Z' }), cfg, now), false);
  assert.equal(included(game('tbd', { timeTbd: true, utcDate: '2026-09-27T12:00:00Z', scheduledDate: '2026-09-26' }), cfg, now), true);
});

test('Competition families keep NFL weeks and NBA Cup rounds together, with explicit exclusions', () => {
  assert.equal(competitionKey(game('nfl', { sport: 'nfl', competition: 'Regular Season - Week 2' })), 'nfl:nfl regular season');
  assert.equal(competitionKey(game('nba', { sport: 'nba', competition: 'NBA Cup - East Group A' })), 'nba:nba cup');
  assert.equal(included(game(), config({ competitionFilters: ['mlb:mlb postseason'] }), now), false);
  assert.equal(included(game('post', { competition: 'MLB Postseason', postseason: true }), config({ competitionFilters: ['mlb:mlb postseason'] }), now), true);
});

test('Filtered events withdraw and restore with the same UID; no new subscription needed', async () => {
  const original = reconcileEvents({}, [game()], config(), now);
  const removed = reconcileEvents(original, [game()], config({ venueFilter: 'away' }), now + 1);
  assert.equal(removed['mlb:one'].status, 'CANCELLED');
  const restored = reconcileEvents(removed, [game()], config(), now + 2);
  assert.equal(restored['mlb:one'].sequence, 2);
  const first = await calendarText({ config: config(), events: original });
  const last = await calendarText({ config: config(), events: restored });
  assert.equal(first.match(/UID:.+/)[0], last.match(/UID:.+/)[0]);
});

test('Undetermined postseason opponents and dates never become timed calendar entries', () => {
  for (const opponent of ['TBD', 'Opponent TBC', 'TBD opponent', 'Winner of Series 2', 'To be determined']) {
    const g = game('post', { opponent, postseason: true });
    assert.equal(confirmedOpponent(g), false);
    assert.deepEqual(reconcileEvents({}, [g], config(), now), {});
    assert.equal(googleGameUrl(g, now), null);
  }
  assert.ok(googleGameUrl(game(), now)?.includes('20260926T230000Z'));
});

test('Change history records time, venue, postponed/restored games and new playoffs, not first loads or scores', () => {
  assert.deepEqual(scheduleChanges([], [game()], team, [], now, false), []);
  assert.deepEqual(scheduleChanges([game()], [game('one', { status: 'final', score: 8 })], team, [], now), []);
  const changed = game('one', { utcDate: '2026-09-27T23:00:00Z', venue: 'New Arena', status: 'postponed' });
  const changes = scheduleChanges([game()], [changed, game('post', { postseason: true })], team, [], now);
  assert.deepEqual(changes[0].fields, ['start', 'venue', 'status']);
  assert.equal(changes[1].postseason, true);
  assert.match(describeChange(changes[0], 'America/New_York'), /Postponed.*Moved from.*Venue:/);
  assert.match(describeChange(changes[1], 'America/New_York'), /New postseason/);
  assert.equal(scheduleChanges([changed], [changed], team, changes, now + 1).length, 2);
  const restored = scheduleChanges([changed], [game()], team, changes, now + 2);
  assert.match(describeChange(restored[0], 'Asia/Tokyo'), /Returned to the schedule/);
});

test('History retention is bounded and provider IDs cannot collide across feeds', () => {
  const histories = scheduleChanges([], Array.from({ length: 110 }, (_, i) => game(String(i))), team, [{ at: now - 91 * 86400000 }], now);
  assert.equal(histories.length, 80);
  assert.ok(JSON.stringify(histories).length < 128 * 1024);
  const changes = scheduleChanges([game()], [game('one', { provider: 'espn' })], team, [], now);
  assert.deepEqual(changes[0].fields, ['added']);
});

test('Reliability distinguishes warming, empty, stale, partial and unpublished seasons', () => {
  const snapshot = { range: seasonRange('mlb', now), updated: now, fixtures: [game()], coverage: 'published' };
  assert.equal(teamHealth(team, null, now).state, 'preparing');
  assert.equal(teamHealth(team, { error: 'offline' }, now).state, 'unavailable');
  assert.equal(teamHealth(team, snapshot, now).state, 'current');
  assert.equal(teamHealth(team, { ...snapshot, fixtures: [] }, now).state, 'unpublished');
  assert.equal(teamHealth(team, { ...snapshot, coverage: 'partial' }, now).state, 'partial');
  assert.equal(teamHealth(team, { ...snapshot, updated: now - 3 * 3600000 }, now).state, 'stale');
  assert.equal(teamHealth(team, snapshot, Date.parse('2027-01-01')).state, 'season-pending');
});

test('Durable history is updated without dashboard visits, survives restarts, and exposes safe diagnostics', async t => {
  let games = [game()], failure = false;
  const h = harness(t, async () => { if (failure) throw Object.assign(new Error('private provider detail'), { status: 429 }); return { fixtures: games, complete: true }; });
  const owner = await (await h.request('/api/calendars', 'POST', config())).json();
  await h.store.alarm();
  h.setTime(now + 3600001); games = [game('one', { venue: 'Changed Arena' })]; await h.store.alarm();
  const restarted = new LivingCalendarStore(h.ctx, {}, () => {});
  const data = await (await restarted.fetch(new Request(`https://test/api/calendars/${owner.id}`))).json();
  assert.equal(data.changes.length, 1); assert.deepEqual(data.changes[0].fields, ['venue']);
  assert.equal(data.competitions[0].key, 'mlb:mlb');
  h.setTime(now + 7200002); failure = true; await h.store.alarm();
  const delayed = await (await h.request(`/api/calendars/${owner.id}`)).json();
  assert.equal(delayed.health[0].reason, 'rate-limit'); assert.equal(delayed.games.length, 1);
  assert.equal(JSON.stringify(delayed).includes('private provider detail'), false);
  assert.equal(delayed.changes.length, 1);
});

test('January and July season boundaries for every sport are deterministic', () => {
  for (const sport of ['soccer', 'nfl', 'nba', 'nhl']) {
    for (const stamp of ['2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z', '2027-06-30T23:59:59Z']) assert.equal(seasonRange(sport, Date.parse(stamp)).from, '2026-07-01');
    assert.equal(seasonRange(sport, Date.parse('2027-07-01T00:00:00Z')).from, '2027-07-01');
  }
  for (const sport of ['mlb', 'f1']) {
    assert.equal(seasonRange(sport, Date.parse('2026-12-31T23:59:59Z')).to, '2026-12-31');
    assert.equal(seasonRange(sport, Date.parse('2027-01-01T00:00:00Z')).from, '2027-01-01');
  }
});

test('A season rollover queues a new range, preserves the old feed during an outage, then accepts an unpublished season', async t => {
  let failed = false, empty = false;
  const ranges = [];
  const h = harness(t, async (_, range) => { ranges.push(range); if (failed) throw new Error('offline'); return { fixtures: empty ? [] : [game()], complete: true }; });
  const owner = await (await h.request('/api/calendars', 'POST', config())).json(); await h.store.alarm();
  const path = `/api/calendars/${owner.id}`, feed = `/calendar/${owner.id}.ics`;
  const original = await (await h.request(feed)).text();
  h.setTime(Date.parse('2027-01-01T00:00:00Z')); failed = true;
  assert.equal((await (await h.request(path)).json()).ready, false);
  await h.store.alarm(); assert.equal(ranges.at(-1).from, '2027-01-01');
  assert.equal(await (await h.request(feed)).text(), original);
  const next = (await h.storage.get('team:mlb:19')).next;
  await h.request(path); assert.equal((await h.storage.get('team:mlb:19')).next, next, 'reads must not erase retry backoff');
  h.setTime(next + 1); failed = false; empty = true; await h.store.alarm();
  const data = await (await h.request(path)).json();
  assert.equal(data.ready, true); assert.equal(data.games.length, 0); assert.equal(data.health[0].state, 'unpublished');
});

test('Large multi-season team snapshots use bounded storage chunks and migrate legacy records', async t => {
  const h = harness(t, async () => ({ fixtures: [], complete: true }));
  await h.storage.put('team:mlb:19', { fixtures: [game()], team });
  assert.equal((await h.store.loadTeam('team:mlb:19')).fixtures.length, 1);
  const fixtures = Array.from({ length: 600 }, (_, i) => game(String(i)));
  await h.store.saveTeam('team:mlb:19', { team, fixtures }, 'history:mlb:19', []);
  assert.equal((await h.store.loadTeam('team:mlb:19')).fixtures.length, 600);
  assert.ok([...h.storage.data.values()].every(value => Buffer.byteLength(JSON.stringify(value)) < 128 * 1024));
  await h.store.saveTeam('team:mlb:19', { team, fixtures: [] }, 'history:mlb:19', []);
  assert.equal((await h.storage.list({ prefix: 'snapshot:' })).size, 0);
});

test('MLB grouping handles doubleheaders, cross-sport interleaving, opponent breaks and postseason site changes', () => {
  const first = game('one'), second = game('two', { utcDate: '2026-09-27T01:00:00Z' });
  const nba = game('nba', { sport: 'nba', utcDate: '2026-09-27T00:00:00Z' });
  const groups = groupWeekSeries([first, nba, second]); assert.equal(groups.length, 2); assert.equal(groups[0].games.length, 2);
  const other = game('other', { awayName: 'New York Mets', opponent: 'New York Mets', utcDate: '2026-09-27T00:00:00Z' });
  assert.equal(groupWeekSeries([first, other, second]).length, 3);
  const road = game('road', { homeName: 'Boston Red Sox', awayName: team.name, home: false, utcDate: '2026-09-28T23:00:00Z' });
  assert.equal(groupWeekSeries([first, road]).length, 2);
  assert.equal(groupWeekSeries([{ ...first, postseason: true }, { ...road, postseason: true }]).length, 1);
  assert.equal(groupWeekSeries([first, game('later', { utcDate: '2026-10-02T23:00:00Z' })]).length, 2);
  assert.equal(groupWeekSeries([first, { ...second, postseason: true }]).length, 2);
});

test('Subscription guides distinguish mobile setup and one-time imports and cite vendor instructions', () => {
  assert.equal(Object.keys(calendarGuides).length, 5);
  assert.match(calendarGuides['google-mobile'].note, /not a subscription/);
  assert.match(calendarGuides.outlook.note, /not Upload from file/);
  for (const guide of Object.values(calendarGuides)) { assert.equal(guide.steps.length, 3); assert.match(guide.source, /^https:\/\/support\.(google|apple|microsoft)\.com\//); }
});

const workerSource = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(workerSource.replace("'./living-calendar.mjs'", JSON.stringify(new URL('./living-calendar.mjs', import.meta.url).href)) + '\nexport { withApiCache };').toString('base64')}`);
test('API outage and unexpectedly empty responses retain a dated last-good snapshot without caching the failure', async t => {
  let clock = now; t.mock.method(Date, 'now', () => clock);
  const cache = new Map();
  globalThis.caches = { default: { async match(key) { const row = cache.get(key.url); return row && row.until > clock ? row.response.clone() : undefined; }, async put(key, response) { const ttl = Number(response.headers.get('cache-control').match(/max-age=(\d+)/)?.[1] || 0); cache.set(key.url, { response: response.clone(), until: clock + ttl * 1000 }); } } };
  const request = new Request('https://test/api/fixtures?sport=mlb&team=19&dateFrom=2026-01-01&dateTo=2026-12-31');
  const good = () => Response.json({ fixtures: [game()], results: 1 });
  const first = await (await worker.withApiCache(request, 3600, good)).json(); assert.equal(first.health.state, 'current');
  clock += 3600001;
  for (const handler of [() => Response.json({ error: 'limit' }, { status: 429 }), () => Response.json({ fixtures: [] }), () => Response.json({ fixtures: [], errors: { provider: 'unavailable' } }), () => Response.json({ fixtures: [], coverage: 'partial' }), () => { throw new Error('offline'); }]) {
    const r = await worker.withApiCache(request, 3600, handler), body = await r.json();
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(body.health.state, 'stale');
    assert.equal(body.health.updated, first.health.updated); assert.equal(body.fixtures.length, 1);
  }
  const other = new Request('https://test/api/fixtures?sport=mlb&team=20');
  assert.equal((await worker.withApiCache(other, 3600, () => Response.json({ error: 'offline' }, { status: 502 }))).status, 502);
  const partial = await worker.withApiCache(other, 3600, () => Response.json({ fixtures: [game()], coverage: 'partial' }));
  assert.equal(partial.headers.get('cache-control'), 'no-store');
  assert.equal((await partial.json()).health.state, 'partial');
  assert.equal((await worker.withApiCache(other, 3600, () => Response.json({ error: 'offline' }, { status: 502 }))).status, 502);
});

test('Primary browser keeps real fixtures on failures and never substitutes sample Arsenal games', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map(), values = new Map(); let outage = false;
  const element = selector => { if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', value: '', options: [{ text: 'Eastern Time' }], selectedIndex: 0, addEventListener() {}, querySelectorAll: () => [] }); return elements.get(selector); };
  const context = vm.createContext({ console, Intl, Date, URLSearchParams, Blob, setTimeout, URL: {}, window: {},
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    document: { querySelector: element, querySelectorAll: () => [] },
    fetch: async () => { if (outage) throw new Error('offline'); return { ok: true, json: async () => ({ fixtures: [game('real', { sport: 'soccer', utcDate: '2099-09-26T23:00:00Z' })] }) }; } });
  vm.runInContext(app, context); await vm.runInContext('loadLiveFixtures()', context);
  outage = true; await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(vm.runInContext('fixtures[0].id', context), 'real');
  assert.match(element('#schedule-health').textContent, /Update delayed/);
  vm.runInContext('currentTeam = {id:61,name:"Chelsea"};', context); await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(vm.runInContext('fixtures.length', context), 0);
  assert.match(element('#source-note').textContent, /No sample games/);
  assert.equal(app.includes('fallbackFixtures'), false);
});
