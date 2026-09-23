// Read-only live audit. --local runs the Worker directly; otherwise checks development.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.MYFIXTURES_URL || 'https://my-fixtures-api-development.sorp.workers.dev';
const now = new Date();
const year = Number(process.env.NHL_SEASON_YEAR || now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0));
const season = `${year}${year + 1}`;
let requestApp = url => fetch(url, { signal: AbortSignal.timeout(45000) });
if (process.argv.includes('--local')) {
  const source = await readFile(new URL('../worker.js', import.meta.url), 'utf8').then(text => text.replace("'./living-calendar.mjs'", JSON.stringify(new URL('../living-calendar.mjs', import.meta.url).href)));
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
  const cache = new Map();
  globalThis.caches = { default: { match: async key => cache.get(key.url)?.clone(), put: async (key, value) => { cache.set(key.url, value.clone()); } } };
  requestApp = url => worker.fetch(new Request(url), {});
}
async function json(url, app = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await (app ? requestApp(url) : fetch(url, { signal: AbortSignal.timeout(30000) }));
    if (response.status === 429 && attempt < 2) {
      await response.body?.cancel();
      console.log('Provider rate limit: pausing audit for 30 seconds.');
      await delay(30000);
      continue;
    }
    assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
    return response.json();
  }
}
const catalog = await json('https://api-web.nhle.com/v1/schedule-calendar/now');
const teams = await json(`${base}/api/teams?sport=nhl`, true);
assert.equal(teams.length, 32);
assert.deepEqual(teams.map(t => t.id).sort((a, b) => a - b), catalog.teams.map(t => t.id).sort((a, b) => a - b));
const durations = [];
const warmDurations = [];
const byGame = new Map();
let appearances = 0;
let tbd = 0;
async function checkTeam(team, startYear = year, bilateral = true) {
  const code = `${startYear}${startYear + 1}`;
  const source = await json(`https://api-web.nhle.com/v1/club-schedule-season/${team.abbreviation}/${code}`);
  const url = `${base}/api/fixtures?${new URLSearchParams({ sport: 'nhl', team: team.id, dateFrom: `${startYear}-07-01`, dateTo: `${startYear + 1}-06-30`, teamName: team.name, teamAbbreviation: team.abbreviation, release: '20260922-nhl-1' })}`;
  const started = performance.now();
  const data = await json(url, true);
  durations.push(performance.now() - started);
  const expected = source.games.filter(g => [1, 2, 3].includes(g.gameType) && String(g.season) === code && !['CNCL', 'CANCELLED', 'CANCELED'].includes(g.gameScheduleState) && g.gameState !== 'CNCL');
  assert.equal(data.season, code);
  assert.equal(data.results, expected.length, `${team.abbreviation}: missing games`);
  assert.deepEqual(data.fixtures.map(f => f.id).sort(), expected.map(g => `nhl-${g.id}`).sort());
  assert.equal(new Set(data.fixtures.map(f => f.id)).size, data.results);
  const fixtures = new Map(data.fixtures.map(f => [f.id, f]));
  for (const game of expected) {
    const fixture = fixtures.get(`nhl-${game.id}`);
    const home = game.homeTeam.id === team.id;
    const opponent = home ? game.awayTeam : game.homeTeam;
    assert.equal(fixture.scheduledDate, game.gameDate, `${team.abbreviation}/${game.id}: date`);
    assert.equal(fixture.utcDate, game.startTimeUTC || `${game.gameDate}T12:00:00Z`, `${team.abbreviation}/${game.id}: time`);
    assert.equal(fixture.home, home);
    assert.equal(fixture.opponentAbbreviation, opponent.abbrev);
    assert.equal(fixture.venue, game.venue?.default || '');
    assert.equal(fixture.postseason, game.gameType === 3);
    assert.equal(fixture.timeTbd, !game.startTimeUTC || game.gameScheduleState !== 'OK' || ['PPD', 'SUSP'].includes(game.gameState));
    if (bilateral) {
      const other = byGame.get(fixture.id);
      if (other) {
        assert.equal(other.utcDate, fixture.utcDate, `${fixture.id}: opposing teams disagree on time`);
        assert.notEqual(other.home, fixture.home);
        other.appearances++;
      } else byGame.set(fixture.id, { ...fixture, appearances: 1 });
    }
  }
  const warmStart = performance.now();
  const warm = await json(url, true);
  warmDurations.push(performance.now() - warmStart);
  assert.deepEqual(warm.fixtures, data.fixtures);
  const regular = expected.filter(g => g.gameType === 2).length;
  if (code === '20262027') assert.equal(regular, 84, `${team.abbreviation}: expected 84 regular-season games`);
  const unconfirmed = data.fixtures.filter(f => f.timeTbd).length;
  if (bilateral) { appearances += data.results; tbd += unconfirmed; }
  console.log(`${team.abbreviation} ${code}: ${data.results} games, ${regular} regular, ${expected.filter(g => g.gameType === 3).length} playoffs, ${unconfirmed} TBD; ${Math.round(durations.at(-1))}ms / warm ${Math.round(warmDurations.at(-1))}ms`);
  return data;
}
// Pace this bulk audit; real users normally request only one team at a time.
for (const team of teams) { await checkTeam(team); await delay(2500); }
for (const [id, game] of byGame) assert.equal(game.appearances, 2, `${id}: missing opposing-team entry`);
const playoffs = await checkTeam(teams.find(t => t.abbreviation === 'FLA'), 2024, false);
assert.equal(playoffs.fixtures.filter(f => f.postseason).length, 23, 'Known completed playoff season');
assert.ok(playoffs.fixtures.some(f => f.id === 'nhl-2024030416' && f.postseason), 'Stanley Cup Final included');
const sorted = durations.toSorted((a, b) => a - b);
console.log(JSON.stringify({ season, teams: teams.length, appearances, uniqueGames: byGame.size, unconfirmedAppearances: tbd, maxMs: Math.round(Math.max(...durations)), p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]), warmMaxMs: Math.round(Math.max(...warmDurations)), postseasonVerified: 23 }, null, 2));
