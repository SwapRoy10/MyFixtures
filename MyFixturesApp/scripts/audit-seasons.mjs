// Read-only live contract check; never creates subscriptions or calendar events.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { seasonRange } from '../living-calendar.mjs';
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'https://my-fixtures-api-development.sorp.workers.dev';
const selections = [
  { sport: 'soccer', team: '57', teamName: 'Arsenal', teamAbbreviation: 'ARS', competitions: 'PL,CL' },
  { sport: 'nhl', team: '4', teamName: 'Philadelphia Flyers', teamAbbreviation: 'PHI' },
  { sport: 'nba', team: '23', teamName: 'Philadelphia 76ers', teamAbbreviation: 'PHI' },
  { sport: 'mlb', team: '19', teamName: 'New York Yankees', teamAbbreviation: 'NYY' },
  { sport: 'nfl', team: '18', teamName: 'Philadelphia Eagles', teamAbbreviation: 'PHI' },
  { sport: 'f1', team: 'f1', teamName: 'Formula 1' }
];
for (let index = 0; index < selections.length; index++) {
  // Give shared free-tier accounts room between paginated schedule requests.
  if (index) await delay(65000);
  const team = selections[index], range = seasonRange(team.sport);
  const params = new URLSearchParams({ ...team, dateFrom: range.from, dateTo: range.to });
  const response = await fetch(`${base}/api/fixtures?${params}`, { signal: AbortSignal.timeout(45000) });
  const data = await response.json();
  assert.equal(response.status, 200, `${team.sport}: ${data.error || response.status}`);
  assert.ok(Array.isArray(data.fixtures), `${team.sport}: missing games array`);
  assert.ok(data.health?.updated, `${team.sport}: missing reliability metadata`);
  assert.notEqual(data.health.state, 'stale', `${team.sport}: serving an old snapshot; provider needs attention`);
  const ids = new Set();
  for (const game of data.fixtures) {
    assert.ok(game.id && !ids.has(String(game.id)), `${team.sport}: duplicate or missing ID`); ids.add(String(game.id));
    assert.ok(Number.isFinite(Date.parse(game.utcDate)), `${team.sport}: invalid timestamp`);
    const date = game.scheduledDate || game.utcDate.slice(0, 10);
    assert.ok(date >= range.from && date <= range.to, `${team.sport}: fixture outside requested season`);
    assert.ok(game.opponent, `${team.sport}: missing opponent label`);
  }
  console.log(`${team.sport}: ${data.fixtures.length} games; season ${range.from}–${range.to}; ${data.health.coverage}${data.fixtures.length ? '' : '; awaiting published games'}`);
}
console.log('All six live season contracts passed.');
