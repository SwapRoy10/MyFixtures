const rosterCache = new Map();
const rosterCacheDuration = 30 * 60 * 1000;
const teamSearchCacheTtl = 12 * 60 * 60;
const fixtureCacheTtl = 60 * 60;
const providerRosterCacheTtl = 12 * 60 * 60;
const providerScheduleCacheTtl = 60 * 60;
const footballCompetitionCodes = ['PL', 'CL', 'ELC', 'FAC', 'SA', 'PPL', 'DED', 'PD', 'BL1', 'FL1'];
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=900',
  'access-control-allow-origin': '*'
};

async function getRoster(code, headers) {
  const cached = rosterCache.get(code);
  if (cached && Date.now() - cached.created < rosterCacheDuration) return cached.teams;
  const { ok, payload } = await fetchProviderJson(`https://api.football-data.org/v4/competitions/${code}/teams`, headers, providerRosterCacheTtl);
  if (!ok) return null;
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

async function fetchProviderJson(providerUrl, headers, ttlSeconds) {
  const cache = caches.default;
  const cacheKey = new Request(providerUrl);
  const cached = await cache.match(cacheKey);
  if (cached) return { ok: true, status: cached.status, payload: await cached.json(), fromCache: true };

  const response = await fetch(providerUrl, { headers });
  const payload = await response.json();
  const providerError = payload.message || payload.error;
  if (response.ok && !providerError) {
    await cache.put(cacheKey, new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttlSeconds}` }
    }));
  }
  return { ok: response.ok && !providerError, status: response.status, payload, fromCache: false };
}

async function searchTeams(url, headers) {
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const rosters = await Promise.all(footballCompetitionCodes.map(async code => ({ code, teams: await getRoster(code, headers) })));
  if (rosters.every(roster => roster.teams === null)) return errorResponse('football-data.org is temporarily unavailable or rate-limited.');
  const teamsById = new Map();
  rosters.forEach(roster => (roster.teams || []).forEach(team => {
    const existing = teamsById.get(team.id) || { ...team, competitions: [] };
    existing.competitions = [...new Set([...existing.competitions, roster.code])];
    teamsById.set(team.id, existing);
  }));
  const teams = [...teamsById.values()].filter(team => `${team.name} ${team.shortName || ''}`.toLowerCase().includes(search));
  return new Response(JSON.stringify(teams.map(team => ({ id: team.id, name: team.shortName || team.name, crest: team.crest, competitions: team.competitions }))), { status: 200, headers: jsonHeaders });
}

async function getTeamCompetitionCodes(teamId, headers) {
  const rosters = await Promise.all(footballCompetitionCodes.map(async code => ({ code, teams: await getRoster(code, headers) })));
  return rosters.filter(roster => (roster.teams || []).some(team => team.id === teamId)).map(roster => roster.code);
}

async function getCompetitionFixtures(code, dateFrom, dateTo, headers) {
  const query = new URLSearchParams({ dateFrom, dateTo, status: 'SCHEDULED' });
  const { ok, payload } = await fetchProviderJson(`https://api.football-data.org/v4/competitions/${code}/matches?${query}`, headers, providerScheduleCacheTtl);
  return ok ? payload.matches || [] : null;
}

async function getTeamFixtures(teamId, dateFrom, dateTo, headers) {
  const apiUrl = `https://api.football-data.org/v4/teams/${teamId}/matches`;
  const query = new URLSearchParams({ dateFrom, dateTo, status: 'SCHEDULED' });
  const response = await fetch(`${apiUrl}?${query}`, { headers });
  const payload = await response.json();
  const responseHeaders = payload.message ? { ...jsonHeaders, 'cache-control': 'no-store' } : jsonHeaders;
  return new Response(JSON.stringify({ fixtures: payload.matches || [], errors: payload.message ? { provider: payload.message } : {}, results: payload.resultSet?.count || 0 }), {
    status: response.ok ? 200 : response.status,
    headers: responseHeaders
  });
}

async function getFixtures(url, headers) {
  const teamId = Number(url.searchParams.get('team') || 57);
  const dateFrom = url.searchParams.get('dateFrom') || '2026-08-01';
  const dateTo = url.searchParams.get('dateTo') || '2027-05-30';
  const requestedCodes = (url.searchParams.get('competitions') || '').split(',').map(code => code.trim()).filter(code => footballCompetitionCodes.includes(code));
  const competitionCodes = requestedCodes.length ? requestedCodes : await getTeamCompetitionCodes(teamId, headers);
  if (competitionCodes.length) {
    const schedules = await Promise.all(competitionCodes.map(code => getCompetitionFixtures(code, dateFrom, dateTo, headers)));
    const providerUnavailable = schedules.every(matches => matches === null);
    const fixtures = schedules
      .flatMap(matches => matches || [])
      .filter((match, index, all) => all.findIndex(candidate => candidate.id === match.id) === index)
      .filter(match => match.homeTeam?.id === teamId || match.awayTeam?.id === teamId);
    if (fixtures.length || !providerUnavailable) {
      return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: 'competition-cache' }), { status: 200, headers: jsonHeaders });
    }
  }
  return getTeamFixtures(teamId, dateFrom, dateTo, headers);
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
