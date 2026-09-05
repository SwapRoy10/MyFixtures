const rosterCache = new Map();
const nflTeamsCache = { created: 0, teams: [] };
const rosterCacheDuration = 30 * 60 * 1000;
const nflTeamsCacheDuration = 12 * 60 * 60 * 1000;
const teamSearchCacheTtl = 12 * 60 * 60;
const fixtureCacheTtl = 60 * 60;
const providerRosterCacheTtl = 12 * 60 * 60;
const providerScheduleCacheTtl = 60 * 60;
const footballCompetitionCodes = ['PL', 'CL', 'EL', 'UCL', 'FAC', 'FLC', 'ELC', 'SA', 'PPL', 'DED', 'PD', 'CDR', 'BL1', 'DFB', 'FL1'];
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=900',
  'access-control-allow-origin': '*'
};

function nflLogoUrl(abbreviation) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`;
}

async function fetchProviderJson(providerUrl, headers, ttlSeconds) {
  const cache = caches.default;
  const cacheKey = new Request(providerUrl);
  const cached = await cache.match(cacheKey);
  if (cached) return { ok: true, status: cached.status, payload: await cached.json(), fromCache: true };

  const response = await fetch(providerUrl, { headers });
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { error: body.slice(0, 300) || response.statusText };
  }
  const providerError = payload.message || payload.error;
  if (response.ok && !providerError) {
    await cache.put(cacheKey, new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttlSeconds}` }
    }));
  }
  return { ok: response.ok && !providerError, status: response.status, payload, fromCache: false };
}

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

async function searchSoccerTeams(url, env) {
  const headers = { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY };
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
  return new Response(JSON.stringify(teams.map(team => ({ id: team.id, sport: 'soccer', name: team.shortName || team.name, crest: team.crest, competitions: team.competitions }))), { status: 200, headers: jsonHeaders });
}

async function getTeamCompetitionCodes(teamId, headers) {
  const rosters = await Promise.all(footballCompetitionCodes.map(async code => ({ code, teams: await getRoster(code, headers) })));
  return rosters.filter(roster => (roster.teams || []).some(team => team.id === teamId)).map(roster => roster.code);
}

async function getCompetitionFixtures(code, dateFrom, dateTo, headers) {
  const query = new URLSearchParams({ dateFrom, dateTo });
  const { ok, payload } = await fetchProviderJson(`https://api.football-data.org/v4/competitions/${code}/matches?${query}`, headers, providerScheduleCacheTtl);
  return ok ? payload.matches || [] : null;
}

function uniqueMatches(matches) {
  return matches.filter((match, index, all) => all.findIndex(candidate => candidate.id === match.id) === index);
}

async function getTeamFixturePayload(teamId, dateFrom, dateTo, headers) {
  const apiUrl = `https://api.football-data.org/v4/teams/${teamId}/matches`;
  const query = new URLSearchParams({ dateFrom, dateTo });
  return fetchProviderJson(`${apiUrl}?${query}`, headers, providerScheduleCacheTtl);
}

async function getTeamFixtures(teamId, dateFrom, dateTo, headers) {
  const { ok, status, payload } = await getTeamFixturePayload(teamId, dateFrom, dateTo, headers);
  const providerError = payload.message || payload.error;
  const responseHeaders = providerError ? { ...jsonHeaders, 'cache-control': 'no-store' } : jsonHeaders;
  return new Response(JSON.stringify({ fixtures: payload.matches || [], errors: providerError ? { provider: providerError } : {}, results: payload.resultSet?.count || 0 }), {
    status: ok ? 200 : status,
    headers: responseHeaders
  });
}

async function getSoccerFixtures(url, env) {
  const headers = { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY };
  const teamId = Number(url.searchParams.get('team') || 57);
  const dateFrom = url.searchParams.get('dateFrom') || '2026-08-01';
  const dateTo = url.searchParams.get('dateTo') || '2027-05-30';
  const requestedCodes = (url.searchParams.get('competitions') || '').split(',').map(code => code.trim()).filter(code => footballCompetitionCodes.includes(code));
  const competitionCodes = requestedCodes.length ? requestedCodes : await getTeamCompetitionCodes(teamId, headers);
  const teamFixturePayload = await getTeamFixturePayload(teamId, dateFrom, dateTo, headers);
  const teamFixtures = teamFixturePayload.ok ? teamFixturePayload.payload.matches || [] : [];

  if (competitionCodes.length) {
    const schedules = await Promise.all(competitionCodes.map(code => getCompetitionFixtures(code, dateFrom, dateTo, headers)));
    const providerUnavailable = schedules.every(matches => matches === null);
    const competitionFixtures = schedules
      .flatMap(matches => matches || [])
      .filter(match => match.homeTeam?.id === teamId || match.awayTeam?.id === teamId);
    const fixtures = uniqueMatches([...competitionFixtures, ...teamFixtures]);
    if (fixtures.length || !providerUnavailable) {
      return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: 'competition-team-cache' }), { status: 200, headers: jsonHeaders });
    }
  }

  if (teamFixturePayload.ok) {
    return new Response(JSON.stringify({ fixtures: teamFixtures, errors: {}, results: teamFixtures.length, source: 'team-cache' }), { status: 200, headers: jsonHeaders });
  }

  return getTeamFixtures(teamId, dateFrom, dateTo, headers);
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

async function searchNflTeams(url, env) {
  const teams = await getNflTeams(env);
  if (!teams) return errorResponse('BALLDONTLIE_API_KEY is missing or the NFL team feed is unavailable.');
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const matches = teams
    .filter(team => `${team.full_name} ${team.name} ${team.location} ${team.abbreviation}`.toLowerCase().includes(search))
    .map(team => ({ id: team.id, sport: 'nfl', name: team.full_name, abbreviation: team.abbreviation, crest: nflLogoUrl(team.abbreviation) }));
  return new Response(JSON.stringify(matches), { status: 200, headers: jsonHeaders });
}

function normalizeEspnNflGame(event, teamAbbreviation) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const selected = competitors.find(entry => entry.team?.abbreviation?.toLowerCase() === teamAbbreviation.toLowerCase());
  const opponent = competitors.find(entry => entry.team?.abbreviation?.toLowerCase() !== teamAbbreviation.toLowerCase());
  const seasonType = event.seasonType?.name || 'NFL';
  const timeTbd = event.timeValid === false || competition.timeValid === false;
  return {
    id: event.id,
    sport: 'nfl',
    utcDate: event.date,
    timeTbd,
    opponent: opponent?.team?.displayName || 'Opponent TBC',
    venue: competition.venue?.fullName || '',
    competition: event.week?.text ? `${seasonType} - ${event.week.text}` : seasonType,
    home: selected?.homeAway === 'home',
    status: event.status?.type?.state || 'scheduled',
    provider: 'espn'
  };
}

async function getEspnNflFixtures(team, dateFrom, dateTo) {
  if (!team?.abbreviation) return [];
  const responses = await Promise.all([1, 2, 3].map(type => fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.abbreviation.toLowerCase()}/schedule?seasontype=${type}`)));
  const payloads = await Promise.all(responses.filter(response => response.ok).map(response => response.json()));
  const events = payloads.flatMap(payload => payload.events || []);
  return events
    .filter((event, index, all) => all.findIndex(candidate => candidate.id === event.id) === index)
    .map(event => normalizeEspnNflGame(event, team.abbreviation))
    .filter(game => {
      const gameDate = game.utcDate.slice(0, 10);
      return game.status !== 'post' && gameDate >= dateFrom && gameDate <= dateTo;
    });
}

async function getNflFixtures(url, env) {
  if (!env.BALLDONTLIE_API_KEY) return errorResponse('BALLDONTLIE_API_KEY is not configured.');
  const teamId = Number(url.searchParams.get('team'));
  if (!teamId) return errorResponse('A BALLDONTLIE NFL team id is required.', 400);
  const teams = await getNflTeams(env);
  const selectedTeam = teams?.find(team => team.id === teamId);
  const dateFrom = url.searchParams.get('dateFrom') || '2026-08-01';
  const dateTo = url.searchParams.get('dateTo') || '2027-05-30';
  const espnGames = await getEspnNflFixtures(selectedTeam, dateFrom, dateTo);
  if (espnGames.length) return new Response(JSON.stringify({ fixtures: espnGames, results: espnGames.length, provider: 'espn' }), { status: 200, headers: jsonHeaders });

  const seasonStartDate = new Date(`${dateFrom}T00:00:00Z`);
  const season = seasonStartDate.getUTCMonth() < 2 ? seasonStartDate.getUTCFullYear() - 1 : seasonStartDate.getUTCFullYear();
  const query = new URLSearchParams({
    'team_ids[]': String(teamId),
    'seasons[]': String(season),
    'season_type[]': '1',
    per_page: '100'
  });
  query.append('season_type[]', '2');
  query.append('season_type[]', '3');
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
      utcDate: game.date,
      opponent: opponent.full_name || `${opponent.location || ''} ${opponent.name || ''}`.trim() || 'Opponent TBC',
      venue: game.venue || '',
      competition: game.season_type === 3 ? 'NFL Postseason' : game.season_type === 1 ? 'NFL Preseason' : 'NFL',
      home: isHome,
      status: game.status_state || game.status || 'scheduled'
    };
  }).filter(game => {
    const gameDate = game.utcDate.slice(0, 10);
    return game.status !== 'final' && gameDate >= dateFrom && gameDate <= dateTo;
  });
  return new Response(JSON.stringify({ fixtures: games, results: games.length, provider: 'balldontlie' }), { status: 200, headers: jsonHeaders });
}

async function getF1Pages(endpoint, query, env) {
  const rows = [];
  const cursors = new Set();
  query.set('per_page', '100');
  while (true) {
    const result = await fetchProviderJson(`https://api.balldontlie.io/f1/v1/${endpoint}?${query}`, { Authorization: env.BALLDONTLIE_API_KEY }, providerScheduleCacheTtl);
    if (!result.ok) {
      const providerMessage = result.payload?.message || result.payload?.error;
      const error = new Error(result.status === 401 || result.status === 403
        ? 'F1 access denied. Check BALLDONTLIE_API_KEY and F1 ALL-STAR or GOAT access for race times.'
        : result.status === 429
          ? 'BALLDONTLIE F1 rate limit reached. Please try again shortly.'
          : `BALLDONTLIE F1 schedule request failed (${result.status})${providerMessage ? `: ${providerMessage}` : '.'}`);
      error.status = result.status >= 400 && result.status <= 599 ? result.status : 502;
      throw error;
    }
    if (!Array.isArray(result.payload.data)) throw new Error('Invalid F1 schedule response.');
    rows.push(...result.payload.data);
    const cursor = result.payload.meta?.next_cursor;
    if (cursor == null) return rows;
    if (cursors.has(String(cursor))) throw new Error('Invalid F1 pagination response.');
    cursors.add(String(cursor));
    query.set('cursor', String(cursor));
  }
}

async function getJolpicaF1Fixtures(dateFrom, dateTo) {
  const seasons = [...new Set([dateFrom.slice(0, 4), dateTo.slice(0, 4)])];
  const responses = await Promise.all(seasons.map(season => fetch(`https://api.jolpi.ca/ergast/f1/${season}/races/?limit=100`, {
    headers: { 'User-Agent': 'MyFixtures/1.0' }
  })));
  const payloads = await Promise.all(responses.map(async response => {
    if (!response.ok) throw new Error(`Jolpica F1 returned ${response.status}`);
    return response.json();
  }));
  if (payloads.some(payload => !payload.MRData?.RaceTable || !Array.isArray(payload.MRData.RaceTable.Races))) {
    throw new Error('Jolpica returned an invalid F1 schedule response');
  }
  return payloads.flatMap(payload => payload.MRData.RaceTable.Races)
    .filter(race => race.date >= dateFrom && race.date <= dateTo)
    .map(race => {
      const time = race.time || '12:00:00Z';
      return {
        id: `f1-jolpica-${race.season}-${race.round}`,
        sport: 'f1',
        utcDate: `${race.date}T${time}`,
        timeTbd: !race.time,
        opponent: race.raceName || 'Grand Prix',
        title: `${race.raceName || 'Grand Prix'} - Race`,
        venue: race.Circuit?.circuitName || '',
        competition: 'Formula 1',
        status: 'scheduled',
        provider: 'jolpica'
      };
    })
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

async function getF1Fixtures(url, env) {
  const year = new Date().getUTCFullYear();
  const dateFrom = url.searchParams.get('dateFrom') || `${year}-01-01`;
  const dateTo = url.searchParams.get('dateTo') || `${year}-12-31`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo || Number(dateTo.slice(0, 4)) - Number(dateFrom.slice(0, 4)) > 1) {
    return errorResponse('Provide a valid F1 date range spanning at most two calendar years.', 400);
  }
  try {
    const jolpicaFixtures = await getJolpicaF1Fixtures(dateFrom, dateTo);
    return new Response(JSON.stringify({ fixtures: jolpicaFixtures, results: jolpicaFixtures.length, provider: 'jolpica' }), { headers: jsonHeaders });
  } catch (jolpicaError) {
    if (!env.BALLDONTLIE_API_KEY) return errorResponse(`Free F1 schedule is unavailable: ${jolpicaError.message}`, 503);
  }
  try {
    const events = [];
    for (let season = Number(dateFrom.slice(0, 4)); season <= Number(dateTo.slice(0, 4)); season += 1) {
      events.push(...await getF1Pages('events', new URLSearchParams({ season: String(season) }), env));
    }
    const excluded = new Set(['final', 'completed', 'canceled', 'cancelled', 'abandoned']);
    // The event status describes the whole race weekend and can be completed
    // before the provider's individual Race session is finalized. Keep every
    // event in the requested date window and use the session status below as
    // the source of truth for whether a race should be returned.
    const upcoming = events.filter(event => event.start_date?.slice(0, 10) <= dateTo && (event.end_date || event.start_date)?.slice(0, 10) >= dateFrom);
    const sessions = [];
    for (let offset = 0; offset < upcoming.length; offset += 20) {
      const query = new URLSearchParams({ type: 'Race' });
      upcoming.slice(offset, offset + 20).forEach(event => query.append('event_ids[]', String(event.id)));
      sessions.push(...await getF1Pages('sessions', query, env));
    }
    const fixtures = [...new Map(sessions.filter(session => session.type === 'Race' && session.date && Number.isFinite(Date.parse(session.date)) && session.date.slice(0, 10) >= dateFrom && session.date.slice(0, 10) <= dateTo && !excluded.has(String(session.status_state || session.status).toLowerCase())).map(session => {
      const event = session.event || upcoming.find(event => event.id === session.event_id) || {};
      return [session.id, { id: `f1-${session.id}`, sport: 'f1', utcDate: session.date, opponent: event.name || 'Grand Prix', title: `${event.name || 'Grand Prix'} - Race`, venue: event.circuit?.name || event.location || '', competition: 'Formula 1', status: session.status_state || session.status || 'unknown', provider: 'balldontlie' }];
    })).values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return new Response(JSON.stringify({ fixtures, results: fixtures.length, provider: 'balldontlie' }), { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.status ? error.message : 'BALLDONTLIE F1 schedule is temporarily unavailable. Please try again later.', error.status || 502);
  }
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
    if (sport === 'f1') {
      if (url.pathname === '/api/teams') return new Response(JSON.stringify([]), { headers: jsonHeaders });
      return withApiCache(request, fixtureCacheTtl, () => getF1Fixtures(url, env));
    }
    if (url.pathname === '/api/teams') {
      return withApiCache(request, teamSearchCacheTtl, () => sport === 'nfl' ? searchNflTeams(url, env) : searchSoccerTeams(url, env));
    }
    return withApiCache(request, fixtureCacheTtl, () => sport === 'nfl' ? getNflFixtures(url, env) : getSoccerFixtures(url, env));
  }
};
