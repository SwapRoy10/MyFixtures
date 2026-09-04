const rosterCache = new Map();
const rosterCacheDuration = 30 * 60 * 1000;
const teamSearchCacheTtl = 12 * 60 * 60;
const fixtureCacheTtl = 60 * 60;
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

function apiCacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete('_');
  url.searchParams.delete('v');
  return new Request(url.toString(), request);
}

function cacheableJsonResponse(response, ttlSeconds) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', `public, max-age=${ttlSeconds}`);
  headers.set('x-myfixtures-cache', 'MISS');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function shouldCacheApiResponse(response) {
  return response.ok && response.headers.get('content-type')?.includes('application/json') && !response.headers.get('cache-control')?.includes('no-store');
}

async function withApiCache(request, ttlSeconds, handler) {
  if (request.method !== 'GET') return handler();
  const cache = caches.default;
  const key = apiCacheKey(request);
  const cached = await cache.match(key);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-myfixtures-cache', 'HIT');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const response = await handler();
  if (!shouldCacheApiResponse(response)) return response;
  const cacheableResponse = cacheableJsonResponse(response, ttlSeconds);
  await cache.put(key, cacheableResponse.clone());
  return cacheableResponse;
}

async function searchTeams(url, headers) {
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const rosters = await Promise.all(['PL', 'CL', 'ELC', 'FAC', 'SA', 'PPL', 'DED', 'PD', 'BL1', 'FL1'].map(code => getRoster(code, headers)));
  if (rosters.every(roster => roster === null)) return errorResponse('football-data.org is temporarily unavailable or rate-limited.');
  const teams = rosters.flatMap(roster => roster || []).filter((team, index, all) => all.findIndex(candidate => candidate.id === team.id) === index).filter(team => `${team.name} ${team.shortName || ''}`.toLowerCase().includes(search));
  return new Response(JSON.stringify(teams.map(team => ({ id: team.id, name: team.shortName || team.name, crest: team.crest }))), { status: 200, headers: jsonHeaders });
}

async function getFixtures(url, headers) {
  const apiUrl = `https://api.football-data.org/v4/teams/${Number(url.searchParams.get('team') || 57)}/matches`;
  const query = new URLSearchParams({ dateFrom: url.searchParams.get('dateFrom') || '2026-08-01', dateTo: url.searchParams.get('dateTo') || '2027-05-30', status: 'SCHEDULED' });
  const upstream = await fetch(`${apiUrl}?${query}`, { headers });
  const payload = await upstream.json();
  const responseHeaders = payload.message ? { ...jsonHeaders, 'cache-control': 'no-store' } : jsonHeaders;
  return new Response(JSON.stringify({ fixtures: payload.matches || [], errors: payload.message ? { provider: payload.message } : {}, results: payload.resultSet?.count || 0 }), {
    status: upstream.ok ? 200 : upstream.status,
    headers: responseHeaders
  });
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
    if (isTeamSearch) {
      return withApiCache(request, teamSearchCacheTtl, () => searchTeams(url, headers));
    }
    return withApiCache(request, fixtureCacheTtl, () => getFixtures(url, headers));
  }
};
