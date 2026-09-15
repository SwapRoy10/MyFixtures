import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

test('soccer combines league fixtures with supplemental cup fixtures', async () => {
  const premierLeagueMatch = {
    id: 100,
    utcDate: '2026-09-12T19:00:00Z',
    status: 'FINISHED',
    competition: { name: 'Premier League' },
    homeTeam: { id: 57, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS' },
    awayTeam: { id: 61, name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE' }
  };
  const cupEvent = {
    id: 'cup-1',
    date: '2026-09-15T19:00:00Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      competitors: [
        { homeAway: 'away', team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal', abbreviation: 'ARS' } },
        { homeAway: 'home', team: { displayName: 'Ipswich Town', shortDisplayName: 'Ipswich', abbreviation: 'IPS' } }
      ],
      venue: { fullName: 'Portman Road' }
    }]
  };

  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/v4/teams/57/matches') return Response.json({ matches: [premierLeagueMatch] });
    if (url.pathname === '/v4/competitions/PL/matches') return Response.json({ matches: [premierLeagueMatch] });
    if (url.pathname.includes('/eng.league_cup/') && url.searchParams.get('dates') === '2026') {
      return Response.json({ leagues: [{ name: 'English Carabao Cup' }], events: [cupEvent] });
    }
    return Response.json({ leagues: [], events: [] });
  };

  const response = await worker.fetch(new Request('https://example.test/api/fixtures?sport=soccer&team=57&teamName=Arsenal&teamAbbreviation=ARS&competitions=PL&dateFrom=2026-07-01&dateTo=2027-06-30'), { FOOTBALL_DATA_API_KEY: 'test-key' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results, 2);
  assert.equal(body.source, 'football-data+espn');
  assert.deepEqual(body.fixtures.map(fixture => fixture.competition).sort(), ['English Carabao Cup', 'Premier League']);
  assert.equal(body.fixtures.find(fixture => fixture.competition === 'Premier League').status, 'finished');
});

test('soccer replaces a provider placeholder with a confirmed league kickoff', async () => {
  const scheduledMatch = {
    id: 200,
    utcDate: '2027-01-01T00:00:00Z',
    status: 'SCHEDULED',
    competition: { code: 'ELC', name: 'Championship' },
    homeTeam: { id: 59, name: 'Blackburn Rovers FC', shortName: 'Blackburn', tla: 'BBR' },
    awayTeam: { id: 70, name: 'Leicester City FC', shortName: 'Leicester City', tla: 'LEI' }
  };
  const confirmedEvent = {
    id: 'championship-1',
    date: '2027-01-01T12:30:00Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      timeValid: true,
      competitors: [
        { homeAway: 'home', team: { displayName: 'Blackburn Rovers', shortDisplayName: 'Blackburn', abbreviation: 'BLK' } },
        { homeAway: 'away', team: { displayName: 'Leicester City', shortDisplayName: 'Leicester', abbreviation: 'LEI' } }
      ]
    }]
  };

  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/v4/teams/59/matches') return Response.json({ matches: [scheduledMatch] });
    if (url.pathname === '/v4/competitions/ELC/matches') return Response.json({ matches: [scheduledMatch] });
    if (url.pathname.includes('/eng.2/') && url.searchParams.get('dates') === '2027') {
      return Response.json({ leagues: [{ name: 'English League Championship' }], events: [confirmedEvent] });
    }
    return Response.json({ leagues: [], events: [] });
  };

  const response = await worker.fetch(new Request('https://example.test/api/fixtures?sport=soccer&team=59&teamName=Blackburn&teamAbbreviation=BBR&competitions=ELC&dateFrom=2026-07-01&dateTo=2027-06-30'), { FOOTBALL_DATA_API_KEY: 'test-key' });
  const body = await response.json();
  assert.equal(body.results, 1);
  assert.equal(body.fixtures[0].utcDate, '2027-01-01T12:30:00Z');
  assert.equal(body.fixtures[0].timeTbd, false);
  assert.equal(body.fixtures[0].provider, 'football-data+espn');
});

test('soccer keeps genuinely provisional league times marked TBD', async () => {
  const scheduledMatch = {
    id: 300,
    utcDate: '2027-04-18T00:00:00Z',
    status: 'SCHEDULED',
    competition: { code: 'PD', name: 'Primera Division' },
    homeTeam: { id: 78, name: 'Club Atletico de Madrid', shortName: 'Atleti', tla: 'ATM' },
    awayTeam: { id: 81, name: 'FC Barcelona', shortName: 'Barcelona', tla: 'FCB' }
  };
  const provisionalEvent = {
    id: 'laliga-1',
    date: '2027-04-18T18:00:00Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      timeValid: false,
      competitors: [
        { homeAway: 'home', team: { displayName: 'Atletico Madrid', shortDisplayName: 'Atletico Madrid', abbreviation: 'ATM' } },
        { homeAway: 'away', team: { displayName: 'Barcelona', shortDisplayName: 'Barcelona', abbreviation: 'BAR' } }
      ]
    }]
  };

  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/v4/teams/78/matches') return Response.json({ matches: [scheduledMatch] });
    if (url.pathname === '/v4/competitions/PD/matches') return Response.json({ matches: [scheduledMatch] });
    if (url.pathname.includes('/esp.1/') && url.searchParams.get('dates') === '2027') {
      return Response.json({ leagues: [{ name: 'Spanish LALIGA' }], events: [provisionalEvent] });
    }
    return Response.json({ leagues: [], events: [] });
  };

  const response = await worker.fetch(new Request('https://example.test/api/fixtures?sport=soccer&team=78&teamName=Club%20Atletico%20de%20Madrid&teamAbbreviation=ATL&competitions=PD&dateFrom=2026-07-01&dateTo=2027-06-30'), { FOOTBALL_DATA_API_KEY: 'test-key' });
  const body = await response.json();
  assert.equal(body.results, 1);
  assert.equal(body.fixtures[0].utcDate, '2027-04-18T00:00:00Z');
  assert.equal(body.fixtures[0].timeTbd, true);
  assert.equal(body.fixtures[0].provider, 'football-data');
});

test('NFL keeps completed games and can use ESPN without a BALLDONTLIE key', async () => {
  const completedGame = {
    id: 'nfl-1',
    date: '2026-09-10T00:20:00Z',
    status: { type: { state: 'post' } },
    seasonType: { name: 'Regular Season' },
    week: { text: 'Week 1' },
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'PHI', displayName: 'Philadelphia Eagles' } },
        { homeAway: 'away', team: { abbreviation: 'DAL', displayName: 'Dallas Cowboys' } }
      ]
    }]
  };
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.ok(url.pathname.includes('/sports/football/nfl/teams/phi/schedule'));
    assert.equal(url.searchParams.get('season'), '2026');
    return Response.json({ events: [completedGame] });
  };

  const response = await worker.fetch(new Request('https://example.test/api/fixtures?sport=nfl&team=18&teamName=Philadelphia%20Eagles&teamAbbreviation=PHI&dateFrom=2026-07-01&dateTo=2027-06-30'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results, 1);
  assert.equal(body.fixtures[0].status, 'post');
});

test('F1 fallback keeps completed races while excluding canceled races', async () => {
  const event = { id: 1, name: 'Italian Grand Prix', start_date: '2026-09-04T10:00:00Z', end_date: '2026-09-06T13:00:00Z' };
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'api.jolpi.ca') return new Response('Unavailable', { status: 502 });
    if (url.pathname.endsWith('/events')) return Response.json({ data: [event], meta: {} });
    return Response.json({ data: [
      { id: 10, event, type: 'Race', date: '2026-09-06T13:00:00Z', status_state: 'completed' },
      { id: 11, event, type: 'Race', date: '2026-09-06T13:00:00Z', status_state: 'canceled' }
    ], meta: {} });
  };

  const response = await worker.fetch(new Request('https://example.test/api/fixtures?sport=f1&dateFrom=2026-01-01&dateTo=2026-12-31'), { BALLDONTLIE_API_KEY: 'test-key' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results, 1);
  assert.equal(body.fixtures[0].status, 'completed');
});
