const rosterCache = new Map();
const nflTeamsCache = { created: 0, teams: [] };
const rosterCacheDuration = 30 * 60 * 1000;
const nflTeamsCacheDuration = 12 * 60 * 60 * 1000;
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=900',
  'access-control-allow-origin': '*'
};

async function getRoster(code, headers) {
  const cached = rosterCache.get(code);
  if (cached && Date.now() - cached.created < rosterCacheDuration) return cached.teams;
  const response = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams`, { headers });
  if (!response.ok) return null;
  const payload = await response.json();
  const teams = payload.teams || [];
  rosterCache.set(code, { created: Date.now(), teams });
  return teams;
}

function errorResponse(message, status = 503) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...jsonHeaders, 'cache-control': 'no-store' }
  });
}

async function getNflTeams(env) {
  if (nflTeamsCache.teams.length && Date.now() - nflTeamsCache.created < nflTeamsCacheDuration) return nflTeamsCache.teams;
  if (!env.BALLDONTLIE_API_KEY) return null;
  const response = await fetch('https://api.balldontlie.io/nfl/v1/teams', {
    headers: { Authorization: env.BALLDONTLIE_API_KEY }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  nflTeamsCache.created = Date.now();
  nflTeamsCache.teams = payload.data || [];
  return nflTeamsCache.teams;
}

async function searchSoccerTeams(url, env) {
  const headers = { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY };
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const rosters = await Promise.all(['PL', 'CL', 'ELC', 'FAC', 'SA', 'PPL', 'DED', 'PD', 'BL1', 'FL1'].map(code => getRoster(code, headers)));
  if (rosters.every(roster => roster === null)) return errorResponse('football-data.org is temporarily unavailable or rate-limited.');
  const teams = rosters
    .flatMap(roster => roster || [])
    .filter((team, index, all) => all.findIndex(candidate => candidate.id === team.id) === index)
    .filter(team => `${team.name} ${team.shortName || ''}`.toLowerCase().includes(search));
  return new Response(JSON.stringify(teams.map(team => ({ id: team.id, sport: 'soccer', name: team.shortName || team.name, crest: team.crest }))), { status: 200, headers: jsonHeaders });
}

async function searchNflTeams(url, env) {
  const teams = await getNflTeams(env);
  if (!teams) return errorResponse('BALLDONTLIE_API_KEY is missing or the NFL team feed is unavailable.');
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const matches = teams
    .filter(team => `${team.full_name} ${team.name} ${team.location} ${team.abbreviation}`.toLowerCase().includes(search))
    .map(team => ({ id: team.id, sport: 'nfl', name: team.full_name, abbreviation: team.abbreviation, crest: null }));
  return new Response(JSON.stringify(matches), { status: 200, headers: jsonHeaders });
}

async function getSoccerFixtures(url, env) {
  const apiUrl = `https://api.football-data.org/v4/teams/${Number(url.searchParams.get('team') || 57)}/matches`;
  const query = new URLSearchParams({ dateFrom: url.searchParams.get('dateFrom') || '2026-08-01', dateTo: url.searchParams.get('dateTo') || '2027-05-30', status: 'SCHEDULED' });
  const upstream = await fetch(`${apiUrl}?${query}`, { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY } });
  const payload = await upstream.json();
  return new Response(JSON.stringify({ fixtures: payload.matches || [], errors: payload.message ? { provider: payload.message } : {}, results: payload.resultSet?.count || 0 }), {
    status: upstream.ok ? 200 : upstream.status,
    headers: jsonHeaders
  });
}

async function getNflFixtures(url, env) {
  if (!env.BALLDONTLIE_API_KEY) return errorResponse('BALLDONTLIE_API_KEY is not configured.');
  const teamId = Number(url.searchParams.get('team'));
  if (!teamId) return errorResponse('A BALLDONTLIE NFL team id is required.', 400);
  const query = new URLSearchParams({
    'team_ids[]': String(teamId),
    start_date: url.searchParams.get('dateFrom') || '2026-08-01',
    end_date: url.searchParams.get('dateTo') || '2027-05-30',
    per_page: '100'
  });
  const response = await fetch(`https://api.balldontlie.io/nfl/v1/games?${query}`, {
    headers: { Authorization: env.BALLDONTLIE_API_KEY }
  });
  const payload = await response.json();
  if (!response.ok) return errorResponse(payload.error || 'BALLDONTLIE NFL schedule feed is unavailable.', response.status);
  const games = (payload.data || []).map(game => {
    const home = game.home_team || {};
    const visitor = game.visitor_team || {};
    const isHome = home.id === teamId;
    const opponent = isHome ? visitor : home;
    return {
      id: game.id,
      sport: 'nfl',
      utcDate: game.datetime || `${game.date}T00:00:00.000Z`,
      opponent: opponent.full_name || `${opponent.location || ''} ${opponent.name || ''}`.trim() || 'Opponent TBC',
      venue: game.venue || '',
      competition: game.season_type === 3 ? 'NFL Postseason' : game.season_type === 1 ? 'NFL Preseason' : 'NFL',
      home: isHome,
      status: game.status_state || game.status || 'scheduled'
    };
  }).filter(game => game.status !== 'final');
  return new Response(JSON.stringify({ fixtures: games, results: games.length }), { status: 200, headers: jsonHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/fixtures' && url.pathname !== '/api/teams') {
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set('cache-control', 'no-store, no-cache, must-revalidate');
      return new Response(assetResponse.body, { status: assetResponse.status, headers });
    }

    const sport = url.searchParams.get('sport') || 'soccer';
    if (url.pathname === '/api/teams') return sport === 'nfl' ? searchNflTeams(url, env) : searchSoccerTeams(url, env);
    return sport === 'nfl' ? getNflFixtures(url, env) : getSoccerFixtures(url, env);
  }
};
