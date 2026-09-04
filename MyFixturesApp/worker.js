const API_BASE_URL = 'https://api.football-data.org/v4/teams/57/matches';
const rosterCache = new Map();
const rosterCacheDuration = 30 * 60 * 1000;

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/fixtures' && url.pathname !== '/api/teams') {
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set('cache-control', 'no-store, no-cache, must-revalidate');
      return new Response(assetResponse.body, { status: assetResponse.status, headers });
    }

    const isTeamSearch = url.pathname === '/api/teams';
    const headers = { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY };
    let upstream;
    let payload;
    if (isTeamSearch) {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const rosters = await Promise.all(['PL', 'CL', 'ELC', 'FAC', 'SA', 'PPL', 'DED', 'PD', 'BL1', 'FL1'].map(code => getRoster(code, headers)));
      if (rosters.every(roster => roster === null)) return new Response(JSON.stringify({ error: 'football-data.org is temporarily unavailable or rate-limited.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
      const teams = rosters.flatMap(roster => roster || []).filter((team, index, all) => all.findIndex(candidate => candidate.id === team.id) === index).filter(team => `${team.name} ${team.shortName || ''}`.toLowerCase().includes(search));
      return new Response(JSON.stringify(teams.map(team => ({ id: team.id, name: team.shortName || team.name, crest: team.crest }))), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900', 'access-control-allow-origin': '*' } });
    }
    const apiUrl = `https://api.football-data.org/v4/teams/${Number(url.searchParams.get('team') || 57)}/matches`;
    const query = new URLSearchParams({ dateFrom: url.searchParams.get('dateFrom') || '2026-08-01', dateTo: url.searchParams.get('dateTo') || '2027-05-30', status: 'SCHEDULED' });
    upstream = await fetch(`${apiUrl}?${query}`, { headers });
    payload = await upstream.json();
    const response = new Response(JSON.stringify({ fixtures: payload.matches || [], errors: payload.message ? { provider: payload.message } : {}, results: payload.resultSet?.count || 0 }), {
      status: upstream.ok ? 200 : upstream.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=900',
        'access-control-allow-origin': '*'
      }
    });
    return response;
  }
};