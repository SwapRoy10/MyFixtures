const rosterCache = new Map();
const nflTeamsCache = { created: 0, teams: [] };
const mlbTeamsCache = { created: 0, teams: [] };
const rosterCacheDuration = 30 * 60 * 1000;
const nflTeamsCacheDuration = 12 * 60 * 60 * 1000;
const mlbTeamsCacheDuration = 12 * 60 * 60 * 1000;
const teamSearchCacheTtl = 12 * 60 * 60;
const fixtureCacheTtl = 60 * 60;
const providerRosterCacheTtl = 12 * 60 * 60;
const providerScheduleCacheTtl = 60 * 60;
const footballCompetitionCodes = ['PL', 'CL', 'EL', 'FAC', 'FLC', 'ELC', 'SA', 'PPL', 'DED', 'PD', 'CDR', 'BL1', 'DFB', 'FL1'];
const footballRosterCompetitionCodes = ['PL', 'CL', 'ELC', 'SA', 'PPL', 'DED', 'PD', 'BL1', 'FL1'];
const espnSoccerLeagues = [
  { code: 'PL', slug: 'eng.1' },
  { code: 'CL', slug: 'uefa.champions' },
  { code: 'ELC', slug: 'eng.2' },
  { code: 'SA', slug: 'ita.1' },
  { code: 'PPL', slug: 'por.1' },
  { code: 'DED', slug: 'ned.1' },
  { code: 'PD', slug: 'esp.1' },
  { code: 'BL1', slug: 'ger.1' },
  { code: 'FL1', slug: 'fra.1' }
];
const espnSoccerSupplements = [
  { slug: 'eng.fa', domesticCodes: ['PL', 'ELC'] },
  { slug: 'eng.league_cup', domesticCodes: ['PL', 'ELC'] },
  { slug: 'esp.copa_del_rey', domesticCodes: ['PD'] },
  { slug: 'ger.dfb_pokal', domesticCodes: ['BL1'] },
  { slug: 'ita.coppa_italia', domesticCodes: ['SA'] },
  { slug: 'fra.coupe_de_france', domesticCodes: ['FL1'] },
  { slug: 'ned.cup', domesticCodes: ['DED'] },
  { slug: 'por.taca.portugal', domesticCodes: ['PPL'] },
  { slug: 'uefa.europa', domesticCodes: [] },
  { slug: 'uefa.europa.conf', domesticCodes: [] }
];
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=900',
  'access-control-allow-origin': '*'
};

function nflLogoUrl(abbreviation) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`;
}

function mlbLogoUrl(abbreviation) {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbreviation.toLowerCase()}.png`;
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
  const rosters = await Promise.all(footballRosterCompetitionCodes.map(async code => ({ code, teams: await getRoster(code, headers) })));
  if (rosters.every(roster => roster.teams === null)) return errorResponse('football-data.org is temporarily unavailable or rate-limited.');

  const teamsById = new Map();
  rosters.forEach(roster => (roster.teams || []).forEach(team => {
    const existing = teamsById.get(team.id) || { ...team, competitions: [] };
    existing.competitions = [...new Set([...existing.competitions, roster.code])];
    teamsById.set(team.id, existing);
  }));

  const teams = [...teamsById.values()].filter(team => `${team.name} ${team.shortName || ''}`.toLowerCase().includes(search));
  return new Response(JSON.stringify(teams.map(team => ({ id: team.id, sport: 'soccer', name: team.shortName || team.name, fullName: team.name, abbreviation: team.tla, crest: team.crest, competitions: team.competitions }))), { status: 200, headers: jsonHeaders });
}

async function getTeamCompetitionCodes(teamId, headers) {
  const rosters = await Promise.all(footballRosterCompetitionCodes.map(async code => ({ code, teams: await getRoster(code, headers) })));
  return rosters.filter(roster => (roster.teams || []).some(team => team.id === teamId)).map(roster => roster.code);
}

async function getCompetitionFixtures(code, dateFrom, dateTo, headers) {
  const query = new URLSearchParams({ dateFrom, dateTo });
  const { ok, payload } = await fetchProviderJson(`https://api.football-data.org/v4/competitions/${code}/matches?${query}`, headers, providerScheduleCacheTtl);
  return ok ? payload.matches || [] : null;
}

function normalizedIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|afc|cf|sc|ac|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamAliases(values) {
  return new Set(values.flatMap(value => {
    const normalized = normalizedIdentity(value);
    const simplified = normalized.replace(/\b(the|de|do|da|del|clube|football|futbol)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized ? [normalized, normalized.replace(/^the /, ''), simplified] : [];
  }));
}

function espnTeamMatches(team, aliases) {
  const candidates = teamAliases([team?.displayName, team?.shortDisplayName, team?.name, team?.abbreviation, team?.location]);
  return [...candidates].some(candidate => aliases.has(candidate));
}

function normalizeFootballDataMatch(match, teamId) {
  const selectedIsHome = match.homeTeam?.id === teamId;
  const opponent = selectedIsHome ? match.awayTeam : match.homeTeam;
  return {
    id: `football-data-${match.id}`,
    sport: 'soccer',
    utcDate: match.utcDate,
    timeTbd: match.status === 'SCHEDULED',
    opponent: opponent?.shortName || opponent?.name || 'Opponent TBC',
    venue: match.venue || '',
    competition: match.competition?.name || 'Soccer',
    competitionCode: match.competition?.code || '',
    home: selectedIsHome,
    status: String(match.status || 'scheduled').toLowerCase(),
    provider: 'football-data'
  };
}

function normalizeEspnSoccerMatch(event, aliases, leagueName, competitionCode = '') {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const selected = competitors.find(entry => espnTeamMatches(entry.team, aliases));
  if (!selected) return null;
  const opponent = competitors.find(entry => entry !== selected);
  return {
    id: `espn-soccer-${event.id}`,
    sport: 'soccer',
    utcDate: event.date,
    timeTbd: event.timeValid === false || competition.timeValid === false,
    opponent: opponent?.team?.shortDisplayName || opponent?.team?.displayName || 'Opponent TBC',
    venue: competition.venue?.fullName || '',
    competition: event.league?.name || leagueName || 'Soccer',
    competitionCode,
    home: selected.homeAway === 'home',
    status: event.status?.type?.state || 'scheduled',
    provider: 'espn'
  };
}

async function getEspnSoccerFixtures(competitionCodes, dateFrom, dateTo, aliases) {
  const primary = espnSoccerLeagues.filter(entry => competitionCodes.includes(entry.code));
  const domestic = espnSoccerSupplements.filter(entry => entry.domesticCodes.length && entry.domesticCodes.some(code => competitionCodes.includes(code)));
  const european = competitionCodes.includes('CL') ? [] : espnSoccerSupplements.filter(entry => !entry.domesticCodes.length);
  const schedulesToFetch = [...primary, ...domestic, ...european];
  const years = [...new Set([dateFrom.slice(0, 4), dateTo.slice(0, 4)])];
  const schedules = await Promise.all(schedulesToFetch.flatMap(entry => years.map(async year => {
    try {
      const query = new URLSearchParams({ dates: year, limit: '500' });
      const result = await fetchProviderJson(`https://site.web.api.espn.com/apis/site/v2/sports/soccer/${entry.slug}/scoreboard?${query}`, { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MyFixtures/1.0)' }, providerScheduleCacheTtl);
      if (!result.ok) return [];
      const leagueName = result.payload.leagues?.[0]?.name;
      return (result.payload.events || [])
        .filter(event => event.date?.slice(0, 10) >= dateFrom && event.date?.slice(0, 10) <= dateTo)
        .map(event => normalizeEspnSoccerMatch(event, aliases, leagueName, entry.code))
        .filter(Boolean);
    } catch {
      return [];
    }
  })));
  return schedules.flat();
}

function mergeSoccerFixtures(footballFixtures, espnFixtures) {
  const unmatchedEspn = [...espnFixtures];
  const mergedFootball = footballFixtures.map(fixture => {
    const matchIndex = unmatchedEspn.findIndex(candidate => {
      if (!candidate.competitionCode || candidate.competitionCode !== fixture.competitionCode || candidate.home !== fixture.home) return false;
      const sameDate = candidate.utcDate?.slice(0, 10) === fixture.utcDate?.slice(0, 10);
      const footballOpponent = normalizedIdentity(fixture.opponent);
      const espnOpponent = normalizedIdentity(candidate.opponent);
      const sameOpponent = footballOpponent === espnOpponent
        || footballOpponent.startsWith(`${espnOpponent} `)
        || espnOpponent.startsWith(`${footballOpponent} `);
      return sameDate || sameOpponent;
    });
    if (matchIndex < 0) return fixture;

    const espnFixture = unmatchedEspn.splice(matchIndex, 1)[0];
    if (!fixture.timeTbd || espnFixture.timeTbd) {
      return { ...fixture, venue: fixture.venue || espnFixture.venue };
    }
    return {
      ...fixture,
      utcDate: espnFixture.utcDate,
      timeTbd: false,
      venue: fixture.venue || espnFixture.venue,
      provider: 'football-data+espn'
    };
  });
  return uniqueFixtures([...mergedFootball, ...unmatchedEspn]);
}

function uniqueFixtures(fixtures) {
  const seenIds = new Set();
  const seenGames = new Set();
  return fixtures.filter(fixture => {
    if (fixture.id != null && seenIds.has(String(fixture.id))) return false;
    const gameKey = fixture.utcDate && fixture.opponent
      ? `${fixture.utcDate.slice(0, 10)}|${fixture.home ? 'home' : 'away'}|${normalizedIdentity(fixture.opponent)}`
      : '';
    if (gameKey && seenGames.has(gameKey)) return false;
    if (fixture.id != null) seenIds.add(String(fixture.id));
    if (gameKey) seenGames.add(gameKey);
    return true;
  });
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
  const aliasValues = [url.searchParams.get('teamName'), url.searchParams.get('teamAbbreviation')];
  teamFixtures.forEach(match => {
    const selected = match.homeTeam?.id === teamId ? match.homeTeam : match.awayTeam?.id === teamId ? match.awayTeam : null;
    if (selected) aliasValues.push(selected.name, selected.shortName, selected.tla);
  });
  const aliases = teamAliases(aliasValues);
  const knownCompetitionCodes = [...new Set([...competitionCodes, ...teamFixtures.map(match => match.competition?.code).filter(Boolean)])];
  const espnFixtures = aliases.size ? await getEspnSoccerFixtures(knownCompetitionCodes, dateFrom, dateTo, aliases) : [];

  if (competitionCodes.length) {
    const schedules = await Promise.all(competitionCodes.map(code => getCompetitionFixtures(code, dateFrom, dateTo, headers)));
    const providerUnavailable = schedules.every(matches => matches === null);
    const competitionFixtures = schedules
      .flatMap(matches => matches || [])
      .filter(match => match.homeTeam?.id === teamId || match.awayTeam?.id === teamId);
    const footballFixtures = uniqueFixtures([...competitionFixtures, ...teamFixtures].map(match => normalizeFootballDataMatch(match, teamId)));
    const fixtures = mergeSoccerFixtures(footballFixtures, espnFixtures);
    if (fixtures.length || !providerUnavailable) {
      return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: espnFixtures.length ? 'football-data+espn' : 'football-data' }), { status: 200, headers: jsonHeaders });
    }
  }

  if (teamFixturePayload.ok) {
    const footballFixtures = uniqueFixtures(teamFixtures.map(match => normalizeFootballDataMatch(match, teamId)));
    const fixtures = mergeSoccerFixtures(footballFixtures, espnFixtures);
    return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: espnFixtures.length ? 'football-data+espn' : 'football-data' }), { status: 200, headers: jsonHeaders });
  }

  if (espnFixtures.length) {
    const fixtures = uniqueFixtures(espnFixtures);
    return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: 'espn' }), { status: 200, headers: jsonHeaders });
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

async function getMlbTeams(env) {
  if (mlbTeamsCache.teams.length && Date.now() - mlbTeamsCache.created < mlbTeamsCacheDuration) return mlbTeamsCache.teams;
  if (!env.BALLDONTLIE_API_KEY) return null;
  const { ok, payload } = await fetchProviderJson('https://api.balldontlie.io/mlb/v1/teams', { Authorization: env.BALLDONTLIE_API_KEY }, providerRosterCacheTtl);
  if (!ok) return null;
  mlbTeamsCache.created = Date.now();
  mlbTeamsCache.teams = payload.data || [];
  return mlbTeamsCache.teams;
}

async function searchMlbTeams(url, env) {
  const teams = await getMlbTeams(env);
  if (!teams) return errorResponse('BALLDONTLIE_API_KEY is missing or the MLB team feed is unavailable.');
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const matches = teams
    .filter(team => `${team.display_name || ''} ${team.short_display_name || ''} ${team.name || ''} ${team.location || ''} ${team.abbreviation || ''}`.toLowerCase().includes(search))
    .map(team => ({ id: team.id, sport: 'mlb', name: team.display_name, abbreviation: team.abbreviation, crest: mlbLogoUrl(team.abbreviation), league: team.league, division: team.division }));
  return new Response(JSON.stringify(matches), { status: 200, headers: jsonHeaders });
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
  const rangeStart = new Date(`${dateFrom}T00:00:00Z`);
  const season = rangeStart.getUTCMonth() < 2 ? rangeStart.getUTCFullYear() - 1 : rangeStart.getUTCFullYear();
  const responses = await Promise.all([1, 2, 3].map(type => fetch(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.abbreviation.toLowerCase()}/schedule?season=${season}&seasontype=${type}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MyFixtures/1.0)' }
  })));
  const payloads = await Promise.all(responses.filter(response => response.ok).map(response => response.json()));
  const events = payloads.flatMap(payload => payload.events || []);
  return events
    .filter((event, index, all) => all.findIndex(candidate => candidate.id === event.id) === index)
    .map(event => normalizeEspnNflGame(event, team.abbreviation))
    .filter(game => {
      const gameDate = game.utcDate.slice(0, 10);
      return gameDate >= dateFrom && gameDate <= dateTo;
    });
}

async function getNflFixtures(url, env) {
  const teamId = Number(url.searchParams.get('team'));
  if (!teamId) return errorResponse('A BALLDONTLIE NFL team id is required.', 400);
  const teams = await getNflTeams(env);
  const selectedTeam = teams?.find(team => team.id === teamId) || {
    id: teamId,
    abbreviation: url.searchParams.get('teamAbbreviation'),
    full_name: url.searchParams.get('teamName')
  };
  const dateFrom = url.searchParams.get('dateFrom') || '2026-08-01';
  const dateTo = url.searchParams.get('dateTo') || '2027-05-30';
  const espnGames = await getEspnNflFixtures(selectedTeam, dateFrom, dateTo);
  if (espnGames.length) return new Response(JSON.stringify({ fixtures: espnGames, results: espnGames.length, provider: 'espn' }), { status: 200, headers: jsonHeaders });
  if (!env.BALLDONTLIE_API_KEY) return errorResponse('The ESPN NFL schedule is unavailable and BALLDONTLIE_API_KEY is not configured.');

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
    return gameDate >= dateFrom && gameDate <= dateTo;
  });
  return new Response(JSON.stringify({ fixtures: games, results: games.length, provider: 'balldontlie' }), { status: 200, headers: jsonHeaders });
}

async function getMlbPages(query, env) {
  const games = [];
  const cursors = new Set();
  query.set('per_page', '100');
  while (true) {
    const result = await fetchProviderJson(`https://api.balldontlie.io/mlb/v1/games?${query}`, { Authorization: env.BALLDONTLIE_API_KEY }, providerScheduleCacheTtl);
    if (!result.ok) {
      const providerMessage = result.payload?.message || result.payload?.error;
      const error = new Error(result.status === 401 || result.status === 403
        ? 'MLB access denied. Check BALLDONTLIE_API_KEY; the Teams and Games endpoints are available on the free MLB tier.'
        : result.status === 429
          ? 'BALLDONTLIE MLB rate limit reached. Please try again shortly.'
          : `BALLDONTLIE MLB schedule request failed (${result.status})${providerMessage ? `: ${providerMessage}` : '.'}`);
      error.status = result.status >= 400 && result.status <= 599 ? result.status : 502;
      throw error;
    }
    if (!Array.isArray(result.payload.data)) throw new Error('Invalid MLB schedule response.');
    games.push(...result.payload.data);
    const cursor = result.payload.meta?.next_cursor;
    if (cursor == null) return games;
    if (cursors.has(String(cursor))) throw new Error('Invalid MLB pagination response.');
    cursors.add(String(cursor));
    query.set('cursor', String(cursor));
  }
}

async function getMlbFixtures(url, env) {
  const teamId = Number(url.searchParams.get('team'));
  if (!teamId) return errorResponse('A BALLDONTLIE MLB team id is required.', 400);
  if (!env.BALLDONTLIE_API_KEY) return errorResponse('BALLDONTLIE_API_KEY is required for MLB schedules.');

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = url.searchParams.get('dateFrom') || today;
  const dateTo = url.searchParams.get('dateTo') || `${dateFrom.slice(0, 4)}-12-31`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo || dateFrom.slice(0, 4) !== dateTo.slice(0, 4)) {
    return errorResponse('Provide a valid MLB date range within one calendar year.', 400);
  }

  try {
    const query = new URLSearchParams({ 'team_ids[]': String(teamId), 'seasons[]': dateFrom.slice(0, 4) });
    const excluded = new Set(['final', 'completed', 'canceled', 'cancelled', 'abandoned']);
    const games = await getMlbPages(query, env);
    const fixtures = [...new Map(games.filter(game => {
      const gameDate = game.date?.slice(0, 10);
      const status = String(game.status_state || game.status || '').toLowerCase().replace(/^status_/, '');
      return gameDate >= dateFrom && gameDate <= dateTo && !excluded.has(status);
    }).map(game => {
      const homeTeam = game.home_team || {};
      const awayTeam = game.away_team || {};
      const isHome = homeTeam.id === teamId;
      const opponent = isHome ? awayTeam : homeTeam;
      return [String(game.id), {
        id: `mlb-${game.id}`,
        sport: 'mlb',
        utcDate: game.date,
        timeTbd: false,
        opponent: opponent.display_name || opponent.short_display_name || opponent.name || (isHome ? game.away_team_name : game.home_team_name) || 'Opponent TBC',
        venue: game.venue || '',
        competition: game.season_type === 'postseason' || game.postseason ? 'MLB Postseason' : 'MLB',
        seasonType: game.season_type || (game.postseason ? 'postseason' : 'regular'),
        postseason: Boolean(game.postseason || game.season_type === 'postseason'),
        home: isHome,
        status: game.status_state || game.status || 'scheduled',
        provider: 'balldontlie'
      }];
    })).values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return new Response(JSON.stringify({ fixtures, results: fixtures.length, provider: 'balldontlie' }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.status ? error.message : 'BALLDONTLIE MLB schedule is temporarily unavailable. Please try again later.', error.status || 502);
  }
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
    const excluded = new Set(['canceled', 'cancelled', 'abandoned']);
    // The event status describes the whole race weekend. Keep completed race
    // sessions so the calendar remains a complete season record.
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
      return withApiCache(request, teamSearchCacheTtl, () => sport === 'nfl' ? searchNflTeams(url, env) : sport === 'mlb' ? searchMlbTeams(url, env) : searchSoccerTeams(url, env));
    }
    return withApiCache(request, fixtureCacheTtl, () => sport === 'nfl' ? getNflFixtures(url, env) : sport === 'mlb' ? getMlbFixtures(url, env) : getSoccerFixtures(url, env));
  }
};
