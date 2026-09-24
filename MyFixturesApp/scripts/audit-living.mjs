// Creates and then stops its own disposable subscription; never writes to a user's calendar.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { confirmedOpponent, matchesPreferences, competitionKey, localDate } from '../schedule-common.mjs';
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://localhost:8787';
const teams = [{ sport: 'nhl', id: 4, name: 'Philadelphia Flyers', abbreviation: 'PHI' }, { sport: 'nhl', id: 8, name: 'Montréal Canadiens', abbreviation: 'MTL' }];
if (process.argv.includes('--all-sports')) teams.push(
  { sport: 'soccer', id: 57, name: 'Arsenal', abbreviation: 'ARS', competitions: ['PL', 'CL'] },
  { sport: 'nfl', id: 18, name: 'Philadelphia Eagles', abbreviation: 'PHI' },
  { sport: 'mlb', id: 19, name: 'New York Yankees', abbreviation: 'NYY' },
  { sport: 'nba', id: 23, name: 'Philadelphia 76ers', abbreviation: 'PHI' },
  { sport: 'f1', id: 'f1', name: 'Formula 1', abbreviation: 'F1' });
const settings = { teams, name: 'Automated Living Calendar check', includeCompleted: true, includePreseason: true, includePostseason: true, timeZone: 'America/New_York', reminder: 30 };
async function request(path, method = 'GET', body, secret, headers = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
}
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
const owner = await json(await request('/api/calendars', 'POST', settings), 201);
const path = `/api/calendars/${owner.id}`, feed = `/calendar/${owner.id}.ics`;
let passed = false;
try {
  let state, lastPending;
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await json(await request(path));
    if (state.ready) break;
    const pending = state.pending.join(', ');
    if (pending !== lastPending) console.log(`Preparing: ${pending}`);
    lastPending = pending;
    await delay(5000);
  }
  assert.equal(state.ready, true, `Schedules failed to finish: ${state.pending.join(', ')}`);
  assert.ok(state.games.length > 0);
  for (const sport of new Set(teams.map(t => t.sport))) assert.ok(state.games.some(g => g.sport === sport), `No games returned for ${sport}`);
  assert.equal(state.health.length, teams.length);
  assert.ok(state.health.every(h => h.checkedAt && h.updated && h.season.from));
  assert.ok(Array.isArray(state.changes));
  assert.ok(state.competitions.length > 0);
  assert.ok(state.games.some(g => g.selectedTeams.length === 2), 'Both selected NHL opponents should share an event');
  assert.equal(state.editToken, undefined);
  assert.equal(state.tokenHash, undefined);
  const response = await request(feed);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/calendar/);
  const ics = (await response.text()).replace(/\r\n /g, '');
  const expected = state.games.filter(g => !g.timeTbd && confirmedOpponent(g) && !/cancel|abandon|postpon|suspend|^ppd$/i.test(g.status || '')).length;
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, expected);
  const uids = ics.match(/^UID:.+$/gm).sort();
  assert.equal(new Set(uids).size, expected);
  assert.match(ics, /BEGIN:VALARM/);
  assert.equal((await request(feed, 'HEAD')).status, 200);
  assert.equal((await request(feed, 'GET', undefined, undefined, { 'if-none-match': response.headers.get('etag') })).status, 304);
  assert.equal((await request(path, 'PUT', { ...settings, revision: state.revision })).status, 403);
  assert.equal((await request(path, 'DELETE')).status, 403);
  await json(await request(path, 'PUT', { ...settings, reminder: 60, revision: state.revision }, owner.editToken));
  const updated = (await (await request(feed)).text()).replace(/\r\n /g, '');
  assert.deepEqual(updated.match(/^UID:.+$/gm).sort(), uids, 'Updates preserve UIDs and the subscription URL');
  assert.match(updated, /TRIGGER:-PT60M/);
  assert.match(updated, /SEQUENCE:1/);
  assert.equal((await request(path, 'PUT', { ...settings, revision: state.revision }, owner.editToken)).status, 409);
  const sample = state.games.find(g => g.sport === 'nhl' && !g.timeTbd && confirmedOpponent(g));
  const date = localDate(sample.utcDate, settings.timeZone);
  const filters = { ...settings, reminder: 60, venueFilter: sample.selectedSides[0], dateFrom: date, dateTo: date, competitionFilters: [competitionKey(sample)], revision: state.revision + 1 };
  await json(await request(path, 'PUT', filters, owner.editToken));
  const filtered = await json(await request(path));
  assert.ok(filtered.games.length > 0);
  assert.ok(filtered.games.every(g => matchesPreferences(g, filters)));
  const filteredFeed = await (await request(feed)).text();
  assert.equal((filteredFeed.match(/STATUS:CONFIRMED/g) || []).length, filtered.games.filter(g => !g.timeTbd && confirmedOpponent(g) && !/cancel|postpon|suspend/i.test(g.status || '')).length);
  assert.match(filteredFeed, /STATUS:CANCELLED/, 'Excluded games are withdrawn from existing subscribers');
  await json(await request(path, 'PUT', { ...settings, reminder: 60, revision: filtered.revision }, owner.editToken));
  const restored = (await (await request(feed)).text()).replace(/\r\n /g, '');
  assert.deepEqual(restored.match(/^UID:.+$/gm).sort(), uids);
  assert.equal((restored.match(/STATUS:CONFIRMED/g) || []).length, expected);
  console.log(JSON.stringify({ target: base, teams: teams.length, sports: [...new Set(state.games.map(g => g.sport))], games: state.games.length, feedEvents: expected, doubleCountedGames: 0, httpCaching: 'passed', ownerAuthorization: 'passed', sameLinkUpdates: 'passed', advancedFilters: 'passed', filterWithdrawalAndRestore: 'passed', perTeamHealth: 'passed' }, null, 2));
  passed = true;
} finally {
  await json(await request(path, 'DELETE', undefined, owner.editToken));
  const stopped = await (await request(feed)).text();
  assert.doesNotMatch(stopped, /STATUS:CONFIRMED/);
  console.log('Disposable test subscription stopped; calendar entries withdrawn.');
}
if (passed) console.log('Living Calendar integration audit passed.');
