// Read-only live contract check; never creates subscriptions or calendar events.
// Each sport is checked even if an earlier one fails. Provider rate limits (429), temporary
// outages (502-504) and timeouts are retried after a pause, because the free BALLDONTLIE key is
// shared with the site's hourly calendar refreshes. Failures are also printed as GitHub Actions
// annotations so the run summary names the sport and the reason.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { seasonRange } from '../living-calendar.mjs';

const base = process.argv.find(arg => /^https?:/.test(arg)) || 'https://my-fixtures-api-development.sorp.workers.dev';
const pauseMs = Number(process.env.AUDIT_PAUSE_MS ?? 65000);
const maxAttempts = Number(process.env.AUDIT_ATTEMPTS ?? 3);
const timeoutMs = Number(process.env.AUDIT_TIMEOUT_MS ?? 45000);
const selections = [
  { sport: 'soccer', team: '57', teamName: 'Arsenal', teamAbbreviation: 'ARS', competitions: 'PL,CL' },
  { sport: 'nhl', team: '4', teamName: 'Philadelphia Flyers', teamAbbreviation: 'PHI' },
  { sport: 'nba', team: '23', teamName: 'Philadelphia 76ers', teamAbbreviation: 'PHI' },
  { sport: 'mlb', team: '19', teamName: 'New York Yankees', teamAbbreviation: 'NYY' },
  { sport: 'nfl', team: '18', teamName: 'Philadelphia Eagles', teamAbbreviation: 'PHI' },
  { sport: 'f1', team: 'f1', teamName: 'Formula 1' }
];
const retryable = status => status === 429 || (status >= 502 && status <= 504);
const github = process.env.GITHUB_ACTIONS === 'true';
const annotate = (level, title, message) => { if (github) console.log(`::${level} title=${title}::${String(message).replace(/\r?\n/g, ' ')}`); };

async function fetchSchedule(team, range) {
  const params = new URLSearchParams({ ...team, dateFrom: range.from, dateTo: range.to });
  for (let attempt = 1; ; attempt++) {
    let status, data, problem;
    try {
      const response = await fetch(`${base}/api/fixtures?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
      data = await response.json().catch(() => ({}));
      if (status === 200) return data;
      problem = `${data.error || 'HTTP error'} (HTTP ${status})`;
    } catch (error) {
      problem = error.name === 'TimeoutError' ? `no response within ${timeoutMs / 1000}s` : `request failed: ${error.message}`;
    }
    const canRetry = status === undefined || retryable(status);
    if (!canRetry || attempt >= maxAttempts) throw new Error(attempt > 1 ? `${problem}; still failing after ${attempt} attempts` : problem);
    console.log(`${team.sport}: ${problem}; retrying in ${Math.round(pauseMs / 1000)}s (attempt ${attempt + 1} of ${maxAttempts})`);
    await delay(pauseMs);
  }
}

function checkSchedule(team, range, data) {
  assert.ok(Array.isArray(data.fixtures), 'missing games array');
  assert.ok(data.health?.updated, 'missing reliability metadata');
  assert.notEqual(data.health.state, 'stale', 'serving an old snapshot; provider needs attention');
  const ids = new Set();
  for (const game of data.fixtures) {
    assert.ok(game.id && !ids.has(String(game.id)), 'duplicate or missing ID'); ids.add(String(game.id));
    assert.ok(Number.isFinite(Date.parse(game.utcDate)), 'invalid timestamp');
    const date = game.scheduledDate || game.utcDate.slice(0, 10);
    assert.ok(date >= range.from && date <= range.to, 'fixture outside requested season');
    assert.ok(game.opponent, 'missing opponent label');
  }
}

const failures = [];
for (let index = 0; index < selections.length; index++) {
  // Give shared free-tier accounts room between paginated schedule requests.
  if (index) await delay(pauseMs);
  const team = selections[index], range = seasonRange(team.sport);
  try {
    const data = await fetchSchedule(team, range);
    checkSchedule(team, range, data);
    console.log(`${team.sport}: ${data.fixtures.length} games; season ${range.from}–${range.to}; ${data.health.coverage}${data.fixtures.length ? '' : '; awaiting published games'}`);
  } catch (error) {
    failures.push({ sport: team.sport, message: error.message });
    console.log(`${team.sport}: FAILED: ${error.message}`);
    annotate('error', `${team.sport} schedule check`, error.message);
  }
}

if (failures.length) {
  const summary = `${failures.length} of ${selections.length} live season checks failed: ${failures.map(f => f.sport).join(', ')}`;
  console.log(summary);
  annotate('notice', 'Season audit', summary);
  process.exitCode = 1;
} else {
  console.log(`All ${selections.length} live season contracts passed.`);
}
