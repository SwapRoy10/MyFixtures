import test from 'node:test';
import assert from 'node:assert/strict';
import { LivingCalendarStore, validateConfig, seasonRange, mergeTeamSnapshot, collectGames, reconcileEvents, calendarText, foldLine, routeCalendarRequest } from './living-calendar.mjs';
import { conflictKeys, filterGames, gameDate } from './calendar-view.mjs';

const now = Date.parse('2026-09-23T12:00:00Z');
const flyers = { sport: 'nhl', id: 4, name: 'Philadelphia Flyers', abbreviation: 'PHI' };
const habs = { sport: 'nhl', id: 8, name: 'Montréal Canadiens', abbreviation: 'MTL' };
const fixture = (id = 'nhl-1', changes = {}) => ({ id, sport: 'nhl', utcDate: '2026-09-26T23:00:00Z', scheduledDate: '2026-09-26', home: true, opponent: habs.name, venue: 'Arena', competition: 'NHL Regular Season', seasonType: 'regular', provider: 'nhl', timeTbd: false, status: 'fut', ...changes });
const config = changes => validateConfig({ teams: [flyers], ...changes });
const collect = (games, cfg = config()) => collectGames(cfg, { 'nhl:4': { fixtures: games } });
class Storage {
  data = new Map(); alarmAt = null;
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { for (const [k, v] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) this.data.set(k, structuredClone(v)); }
  async delete(key) { return this.data.delete(key); }
  async list({ prefix }) { return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
  async transaction(callback) { return callback(this); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(value) { this.alarmAt = value; }
  async deleteAlarm() { this.alarmAt = null; }
}
function harness(t, load) {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const storage = new Storage();
  const store = new LivingCalendarStore({ storage, blockConcurrencyWhile: callback => callback() }, {}, load);
  return { store, storage, advance(ms) { clock += ms; }, async request(path, method = 'GET', body, secret) {
    return store.fetch(new Request(`https://fixtures.test${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  } };
}

test('Living Calendar validates supported teams, caps selection, deduplicates and validates settings', () => {
  assert.equal(config({ teams: [flyers, flyers, habs] }).teams.length, 2);
  for (const invalid of [{ teams: [] }, { teams: Array(13).fill(flyers) }, { teams: [{ ...flyers, sport: 'curling' }] }, { teams: [{ ...flyers, id: '../secret' }] }, { timeZone: 'invalid/zone' }, { reminder: -2 }]) assert.throws(() => config(invalid));
  assert.equal(config({ name: 'My\r\nCalendar' }).name, 'My  Calendar');
  assert.deepEqual(seasonRange('nba', Date.parse('2027-02-03')), { from: '2026-07-01', to: '2027-06-30' });
  assert.deepEqual(seasonRange('nhl', Date.parse('2027-07-01')), { from: '2027-07-01', to: '2028-06-30' });
  assert.deepEqual(seasonRange('mlb', now), { from: '2026-01-01', to: '2026-12-31' });
});

test('Two selected opponents share one event while doubleheaders stay separate', () => {
  const cfg = config({ teams: [flyers, habs] });
  const games = collectGames(cfg, { 'nhl:4': { fixtures: [fixture(), fixture('nhl-2')] }, 'nhl:8': { fixtures: [fixture('nhl-1', { home: false, opponent: flyers.name }), fixture('nhl-2', { home: false, opponent: flyers.name })] } });
  assert.equal(games.length, 2);
  assert.ok(games.every(game => game.selectedTeams.length === 2));
  assert.ok(games.every(game => game.title === 'Philadelphia Flyers v Montréal Canadiens'));
});

test('Time/venue changes, withdrawals and restored times preserve UID and advance sequence only on changes', async () => {
  const cfg = config();
  let events = reconcileEvents({}, collect([fixture()]), cfg, now);
  const id = Object.keys(events)[0];
  const original = await calendarText({ config: cfg, events });
  const unchanged = reconcileEvents(events, collect([fixture()]), cfg, now + 1000);
  assert.equal(await calendarText({ config: cfg, events: unchanged }), original);
  events = reconcileEvents(events, collect([fixture('nhl-1', { utcDate: '2026-09-27T00:00:00Z', venue: 'New Arena' })]), cfg, now + 2000);
  assert.equal(events[id].sequence, 1);
  const changed = await calendarText({ config: cfg, events });
  assert.equal(original.match(/UID:.+/)[0], changed.match(/UID:.+/)[0]);
  assert.match(changed, /DTSTART:20260927T000000Z/);
  assert.match(changed, /LOCATION:New Arena/);
  events = reconcileEvents(events, collect([fixture('nhl-1', { timeTbd: true })]), cfg, now + 3000);
  assert.equal(events[id].status, 'CANCELLED');
  assert.equal(events[id].sequence, 2);
  events = reconcileEvents(events, collect([fixture()]), cfg, now + 4000);
  assert.equal(events[id].status, 'CONFIRMED');
  assert.equal(events[id].sequence, 3);
  events = reconcileEvents(events, collect([fixture('nhl-1', { status: 'cancelled' })]), cfg, now + 5000);
  assert.equal(events[id].status, 'CANCELLED');
  assert.equal(events[id].sequence, 4);
});

test('Schedule history survives partial/empty responses; removal requires two complete snapshots', () => {
  const range = seasonRange('nhl', now);
  const previous = [fixture(), fixture('nhl-2')];
  const partial = mergeTeamSnapshot(previous, [fixture('nhl-2')], range, false, now);
  assert.equal(partial.find(f => f.id === 'nhl-1').status, 'fut');
  assert.throws(() => mergeTeamSnapshot(previous, [], range, true, now));
  const first = mergeTeamSnapshot(previous, [fixture('nhl-2')], range, true, now);
  assert.equal(first.find(f => f.id === 'nhl-1').status, 'fut');
  const second = mergeTeamSnapshot(first, [fixture('nhl-2')], range, true, now + 3600000);
  assert.equal(second.find(f => f.id === 'nhl-1').status, 'cancelled');
  assert.equal(mergeTeamSnapshot(second, previous, range, true, now + 7200000).find(f => f.id === 'nhl-1').status, 'fut');
});

test('Completed, preseason and postseason settings affect the feed; TBD starts never create timed entries', async () => {
  const games = collect([fixture('regular'), fixture('pre', { seasonType: 'preseason' }), fixture('post', { postseason: true }), fixture('past', { utcDate: '2026-09-01T23:00:00Z' }), fixture('tbd', { timeTbd: true })]);
  const regularOnly = config({ includePreseason: false, includePostseason: false });
  assert.equal(Object.keys(reconcileEvents({}, games, regularOnly, now)).length, 1);
  assert.equal(Object.keys(reconcileEvents({}, games, config({ includeCompleted: true }), now)).length, 4);
  const reminder = await calendarText({ config: config(), events: reconcileEvents({}, games, config(), now) });
  assert.match(reminder, /TRIGGER:-PT30M/);
  const silent = await calendarText({ config: config({ reminder: 0 }), events: reconcileEvents({}, games, config({ reminder: 0 }), now) });
  assert.doesNotMatch(silent, /BEGIN:VALARM/);
});

test('ICS escapes injection and folds Unicode lines within 75 UTF-8 octets', async () => {
  const text = 'Montréal 🏒 '.repeat(30);
  const folded = foldLine(text);
  assert.equal(folded.replace(/\r\n /g, ''), text);
  assert.ok(folded.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
  const cfg = config({ name: 'Test calendar' });
  const events = reconcileEvents({}, collect([fixture('nhl-1', { venue: 'Arena;\r\nBEGIN:VEVENT,\\', opponent: text })]), cfg, now);
  const ics = await calendarText({ config: cfg, events });
  assert.equal(ics.match(/^BEGIN:VEVENT$/gm).length, 1);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /LOCATION:Arena\\;\\nBEGIN:VEVENT\\,\\\\/);
});

test('My Week handles local midnight, weekends, postseason and estimated overlaps', () => {
  const games = collect([fixture('one', { utcDate: '2026-09-26T01:00:00Z' }), fixture('two', { utcDate: '2026-09-26T02:00:00Z', postseason: true }), fixture('three', { utcDate: '2026-09-26T05:00:00Z' }), fixture('tbd', { timeTbd: true, scheduledDate: '2026-09-27' })]);
  assert.equal(gameDate(games[0], 'America/Los_Angeles'), '2026-09-25');
  assert.equal(gameDate(games.find(g => g.id === 'tbd'), 'Pacific/Kiritimati'), '2026-09-27');
  assert.equal(filterGames(games, { period: 'weekend', timeZone: 'America/Los_Angeles' }, now).length, 1);
  assert.equal(filterGames(games, { period: 'today', timeZone: 'America/Los_Angeles' }, now).length, 0);
  assert.equal(filterGames(games, { period: 'season', postseasonOnly: true }, now).length, 1);
  assert.equal(conflictKeys(games).size, 2);
});

test('Persistent subscription API: first-load readiness, ETags, authorization, settings, restart and stop', async t => {
  const h = harness(t, async team => ({ fixtures: [fixture('nhl-1', team.id === 8 ? { home: false, opponent: flyers.name } : {})], complete: true }));
  const response = await h.request('/api/calendars', 'POST', config({ teams: [flyers, habs] }));
  assert.equal(response.status, 201);
  const owner = await response.json();
  const path = `/api/calendars/${owner.id}`, feed = `/calendar/${owner.id}.ics`;
  assert.equal((await h.request(feed)).status, 503);
  await h.store.alarm(); h.advance(1100);
  assert.equal((await h.request(feed)).status, 503, 'never publish a partial initial feed');
  await h.store.alarm();
  const publicData = await (await h.request(path)).json();
  assert.equal(publicData.ready, true);
  assert.equal(publicData.games.length, 1);
  assert.equal(publicData.games[0].selectedTeams.length, 2);
  assert.equal(publicData.editToken, undefined);
  assert.equal(publicData.tokenHash, undefined);
  const first = await h.request(feed);
  const ics = await first.text();
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.equal(first.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const conditional = await h.store.fetch(new Request(`https://fixtures.test${feed}`, { headers: { 'if-none-match': first.headers.get('etag') } }));
  assert.equal(conditional.status, 304);
  assert.equal(await (await h.request(feed, 'HEAD')).text(), '');
  assert.equal((await h.request(path, 'PUT', { ...config(), revision: 1 })).status, 403);
  assert.equal((await h.request(path, 'DELETE')).status, 403);
  const edit = await h.request(path, 'PUT', { ...config({ name: 'Updated name', reminder: 60 }), revision: 1 }, owner.editToken);
  assert.equal(edit.status, 200);
  assert.equal((await h.request(path, 'PUT', { ...config(), revision: 1 }, owner.editToken)).status, 409);
  const second = await (await h.request(feed)).text();
  assert.match(second, /X-WR-CALNAME:Updated name/);
  assert.match(second, /TRIGGER:-PT60M/);
  assert.equal(second.match(/UID:.+/)[0], ics.match(/UID:.+/)[0]);
  const restarted = new LivingCalendarStore({ storage: h.storage, blockConcurrencyWhile: callback => callback() }, {}, async () => { throw new Error('should not refresh during reads'); });
  assert.equal(await (await restarted.fetch(new Request(`https://fixtures.test${feed}`))).text(), second);
  assert.equal((await h.request(path, 'DELETE', undefined, owner.editToken)).status, 200);
  const stopped = await (await h.request(feed)).text();
  assert.match(stopped, /STATUS:CANCELLED/);
  assert.doesNotMatch(stopped, /BEGIN:VALARM/);
  assert.equal((await h.request(path, 'PUT', { ...config(), revision: 3 }, owner.editToken)).status, 409);
});

test('Provider outage preserves published events and scheduled alarms retry; rate pacing shares one team job', async t => {
  let outage = false, calls = 0;
  const h = harness(t, async () => { calls++; if (outage) throw new Error('429'); return { fixtures: [fixture()], complete: true }; });
  const owner = await (await h.request('/api/calendars', 'POST', config())).json();
  await h.request('/api/calendars', 'POST', config());
  assert.equal((await h.storage.list({ prefix: 'team:' })).size, 1);
  await h.store.alarm();
  const before = await (await h.request(`/calendar/${owner.id}.ics`)).text();
  outage = true; h.advance(3600001); await h.store.alarm();
  assert.equal(calls, 2);
  assert.equal(await (await h.request(`/calendar/${owner.id}.ics`)).text(), before);
  assert.equal((await (await h.request(`/api/calendars/${owner.id}`)).json()).delayed.length, 1);
  assert.ok(h.storage.alarmAt > Date.now());
});

test('Calendar storage supports a large multi-team ledger without oversized values', async t => {
  const h = harness(t, async () => ({ fixtures: [], complete: true }));
  const games = collect(Array.from({ length: 1800 }, (_, i) => fixture(`nhl-${i}`, { opponent: `Opponent ${i}` })));
  const events = reconcileEvents({}, games, config(), now);
  await h.store.saveRecord({ id: 'test', config: config(), events });
  assert.ok([...h.storage.data.values()].every(v => new TextEncoder().encode(JSON.stringify(v)).length < 128 * 1024));
  assert.equal(Object.keys((await h.store.loadRecord('test')).events).length, 1800);
});

test('Calendar route rejects cross-origin writes and a missing storage binding', async () => {
  assert.equal(routeCalendarRequest(new Request('https://fixtures.test/'), {}), null);
  assert.equal(routeCalendarRequest(new Request('https://fixtures.test/api/calendars'), {}).status, 503);
  assert.equal(routeCalendarRequest(new Request('https://fixtures.test/api/calendars', { method: 'POST', headers: { origin: 'https://other.test' } }), { CALENDARS: {} }).status, 403);
});

test('Stopping a subscription releases only unshared team refresh jobs', async t => {
  const h = harness(t, async () => ({ fixtures: [fixture()], complete: true }));
  const first = await (await h.request('/api/calendars', 'POST', config({ teams: [flyers, habs] }))).json();
  const second = await (await h.request('/api/calendars', 'POST', config())).json();
  await h.request(`/api/calendars/${first.id}`, 'DELETE', undefined, first.editToken);
  assert.equal((await h.storage.get('team:nhl:8')).activeUntil, 0);
  assert.ok((await h.storage.get('team:nhl:4')).activeUntil > Date.now());
  await h.request(`/api/calendars/${second.id}`, 'DELETE', undefined, second.editToken);
  assert.equal((await h.storage.get('team:nhl:4')).activeUntil, 0);
  await h.store.alarm();
  assert.equal(await h.storage.getAlarm(), null);
});
