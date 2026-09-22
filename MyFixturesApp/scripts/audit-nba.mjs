// Read-only live verification. Pace new team requests for BALLDONTLIE's free tier.
// node scripts/audit-nba.mjs [development URL] [comma-separated abbreviations|all]
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

const base = process.argv[2] || 'https://my-fixtures-api-development.sorp.workers.dev';
const selection = process.argv[3] || 'PHI,NYK,LAL,GSW,SAS,MIA';
const now = new Date();
const season = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
const espnCode = value => ({ GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' }[value] || value).toLowerCase();
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.json();
}
const teams = await json(`${base}/api/teams?sport=nba`);
assert.equal(teams.length, 30, 'Current NBA roster should contain 30 teams');
assert.equal(new Set(teams.map(team => team.id)).size, 30);
console.log(JSON.stringify({ roster: teams.length, season, selected: selection }));
const wanted = selection.split(',');
const auditTeams = selection === 'all' ? teams : wanted.map(abbr => {
  const team = teams.find(team => team.abbreviation === abbr);
  assert.ok(team, `Missing team ${abbr}`);
  return team;
});
let failures = 0;
for (let index = 0; index < auditTeams.length; index++) {
  if (index) await pause(31000);
  const team = auditTeams[index];
  try {
    const payload = await json(`${base}/api/fixtures?sport=nba&team=${team.id}&dateFrom=${season}-07-01&dateTo=${season + 1}-06-30&release=20260922-nba-2`);
    assert.ok(payload.results > 0, `${team.name}: empty schedule`);
    assert.equal(payload.results, payload.fixtures.length);
    assert.equal(new Set(payload.fixtures.map(game => game.id)).size, payload.results);
    assert.ok(payload.fixtures.every(game => Number.isFinite(Date.parse(game.utcDate)) && game.opponent && game.sport === 'nba'));
    const schedules = await Promise.all([1, 2, 3].map(type => json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnCode(team.abbreviation)}/schedule?season=${season + 1}&seasontype=${type}`)));
    const events = [...new Map(schedules.flatMap(s => s.events || []).map(event => [event.id, event])).values()];
    const mismatches = [];
    let compared = 0;
    for (const event of events) {
      const competition = event.competitions?.[0];
      const selected = competition?.competitors?.find(c => espnCode(c.team.abbreviation) === espnCode(team.abbreviation));
      const opponent = competition?.competitors?.find(c => c !== selected);
      if (!selected || !opponent || /cancel|abandon/i.test(competition.status?.type?.name || '')) continue;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(event.date));
      const match = payload.fixtures.find(f => f.scheduledDate === date && f.home === (selected.homeAway === 'home') && espnCode(f.opponentAbbreviation) === espnCode(opponent.team.abbreviation));
      if (!match) { mismatches.push({ event: event.id, date, issue: 'Missing opponent/date/site match', opponent: opponent.team.displayName }); continue; }
      compared++;
      if (event.timeValid !== false && competition.timeValid !== false && !match.timeTbd && Date.parse(event.date) !== Date.parse(match.utcDate)) mismatches.push({ event: event.id, issue: 'Start time differs', espn: event.date, actual: match.utcDate });
      if (competition.venue?.fullName && match.venue !== competition.venue.fullName) mismatches.push({ event: event.id, issue: 'Venue differs' });
    }
    const summary = { team: team.name, total: payload.results, preseason: payload.fixtures.filter(f => f.seasonType === 'preseason').length,
      cup: payload.fixtures.filter(f => f.competition.startsWith('NBA Cup')).length,
      tbd: payload.fixtures.filter(f => f.timeTbd).length, compared, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 5) };
    console.log(JSON.stringify(summary));
    if (mismatches.length || !compared) failures++;
  } catch (error) {
    failures++;
    console.log(JSON.stringify({ team: team.name, error: error.message }));
  }
}
console.log(JSON.stringify({ checked: auditTeams.length, failures }));
process.exitCode = failures ? 1 : 0;
