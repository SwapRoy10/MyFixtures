import { LivingCalendarStore, routeCalendarRequest } from './living-calendar.mjs';

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
const publicAssetPaths = new Set([
  '/', '/index.html', '/calendar', '/calendar.html', '/app.js', '/calendar-ui.mjs',
  '/calendar-view.mjs', '/calendar-guides.mjs', '/schedule-common.mjs',
  '/app.css', '/favicon.svg', '/og-image.png'
]);
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
const contentSecurityPolicy = [
  "default-src 'self'", "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' https: data:",
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com",
  'frame-src https://accounts.google.com', "object-src 'none'", "base-uri 'none'",
  "frame-ancestors 'none'", "form-action 'self'", 'upgrade-insecure-requests'
].join('; ');

function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', contentSecurityPolicy);
  headers.set('strict-transport-security', 'max-age=31536000');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function nflLogoUrl(abbreviation) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`;
}

function mlbLogoUrl(abbreviation) {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbreviation.toLowerCase()}.png`;
}

// NHL's public feed provides full team-season schedules without a key or pagination.
async function getNhlData(path, field, ttl) {
  const key = new Request(`https://api-web.nhle.com/v1/${path}`);
  const cached = await caches.default.match(key);
  if (cached) return cached.json();
  const response = await fetch(key.url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error('NHL schedule provider is temporarily unavailable. Please try again later.'), { status: response.status === 429 ? 429 : 502 });
  const data = await response.json();
  if (!Array.isArray(data?.[field])) throw new Error('Invalid NHL schedule response. Please try again later.');
  await caches.default.put(key, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
  return data;
}

async function getNhlTeams() {
  const data = await getNhlData('schedule-calendar/now', 'teams', providerRosterCacheTtl);
  return data.teams.filter(team => Number.isSafeInteger(team.id) && /^[A-Z]{3}$/.test(team.abbrev) && team.name?.default)
    .map(team => ({ id: team.id, sport: 'nhl', name: team.name.default, abbreviation: team.abbrev, crest: team.logo }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function searchNhlTeams(url) {
  try {
    const search = normalizedIdentity(url.searchParams.get('search'));
    const teams = (await getNhlTeams()).filter(team => normalizedIdentity(`${team.name} ${team.abbreviation}`).includes(search));
    return Response.json(teams, { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.name === 'TimeoutError' ? 'NHL provider timed out. Please try again.' : error.message, error.status || 502);
  }
}

function validNhlDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function normalizeNhlGame(game, teamId) {
  const home = game.homeTeam?.id === teamId;
  if (!home && game.awayTeam?.id !== teamId) return null;
  if (![1, 2, 3].includes(game.gameType) || ['CNCL', 'CANCELLED', 'CANCELED'].includes(game.gameScheduleState) || game.gameState === 'CNCL') return null;
  if (!game.id || !validNhlDate(game.gameDate)) throw new Error('Invalid NHL game date. Please try again later.');
  const opponent = home ? game.awayTeam : game.homeTeam;
  const hasTime = typeof game.startTimeUTC === 'string' && /T\d{2}:\d{2}.*Z$/.test(game.startTimeUTC) && Number.isFinite(Date.parse(game.startTimeUTC));
  const timeTbd = !hasTime || game.gameScheduleState !== 'OK' || ['PPD', 'SUSP'].includes(game.gameState);
  const postseason = game.gameType === 3;
  const seasonType = game.gameType === 1 ? 'preseason' : postseason ? 'playoffs' : 'regular';
  return { id: `nhl-${game.id}`, sport: 'nhl', utcDate: hasTime ? game.startTimeUTC : `${game.gameDate}T12:00:00Z`,
    scheduledDate: game.gameDate, timeTbd, opponent: [opponent?.placeName?.default, opponent?.commonName?.default].filter(Boolean).join(' ') || 'Opponent TBC',
    opponentAbbreviation: opponent?.abbrev || '', venue: game.venue?.default || '', home, neutralSite: Boolean(game.neutralSite),
    competition: postseason ? 'NHL Stanley Cup Playoffs' : game.gameType === 1 ? 'NHL Preseason' : 'NHL Regular Season',
    seasonType, postseason, status: String(game.gameState || 'FUT').toLowerCase(), provider: 'nhl' };
}

async function getNhlFixtures(url) {
  const teamId = Number(url.searchParams.get('team'));
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return errorResponse('A valid NHL team id is required.', 400);
  const now = new Date();
  const defaultSeason = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const dateFrom = url.searchParams.get('dateFrom') || `${defaultSeason}-07-01`;
  const dateTo = url.searchParams.get('dateTo') || `${defaultSeason + 1}-06-30`;
  const year = Number(dateFrom.slice(0, 4)) - (dateFrom.slice(5, 7) < '07' ? 1 : 0);
  if (!validNhlDate(dateFrom) || !validNhlDate(dateTo) || dateFrom > dateTo || dateTo > `${year + 1}-06-30`) return errorResponse('Provide a valid NHL date range within one July-to-June season.', 400);
  try {
    const team = (await getNhlTeams()).find(entry => entry.id === teamId);
    if (!team) return errorResponse('NHL team not found.', 404);
    const season = `${year}${year + 1}`;
    const data = await getNhlData(`club-schedule-season/${team.abbreviation}/${season}`, 'games', providerScheduleCacheTtl);
    const games = data.games.filter(game => String(game.season) === season).map(game => normalizeNhlGame(game, teamId))
      .filter(game => game && game.scheduledDate >= dateFrom && game.scheduledDate <= dateTo);
    // Split-squad preseason games can share opponents and dates: only dedupe by ID.
    const fixtures = [...new Map(games.map(game => [game.id, game])).values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return Response.json({ fixtures, results: fixtures.length, provider: 'nhl', season }, { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.name === 'TimeoutError' ? 'NHL provider timed out. Please try again.' : error.message, error.status || 502);
  }
}

function nbaEspnCode(abbreviation) {
  const code = String(abbreviation || '').toUpperCase();
  return ({ GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' }[code] || code).toLowerCase();
}

// Teams and Games are the only BALLDONTLIE endpoints used for NBA (both free).
async function getNbaPages(endpoint, query, env) {
  if (!env.BALLDONTLIE_API_KEY) throw Object.assign(new Error('BALLDONTLIE_API_KEY is required for NBA schedules.'), { status: 503 });
  const rows = [];
  const cursors = new Set();
  let pages = 0;
  query.set('per_page', '100');
  while (true) {
    if (++pages > 25) throw new Error('NBA schedule provider returned too many pages.');
    const result = await fetchProviderJson(`https://api.balldontlie.io/v1/${endpoint}?${query}`, { Authorization: env.BALLDONTLIE_API_KEY }, endpoint === 'teams' ? providerRosterCacheTtl : providerScheduleCacheTtl);
    if (!result.ok) {
      const message = result.status === 429 ? 'NBA schedule provider is busy. Please try again in a minute.'
        : result.status === 401 || result.status === 403 ? 'NBA access denied. Check the BALLDONTLIE API key.'
          : 'NBA schedule provider is temporarily unavailable. Please try again later.';
      throw Object.assign(new Error(message), { status: result.status >= 400 ? result.status : 502 });
    }
    if (!Array.isArray(result.payload.data)) throw new Error('Invalid NBA schedule response.');
    if (rows.length + result.payload.data.length > 2500) throw new Error('NBA schedule provider returned too many games.');
    rows.push(...result.payload.data);
    const cursor = result.payload.meta?.next_cursor;
    if (cursor == null) return rows;
    if (cursors.has(String(cursor))) throw new Error('Invalid NBA pagination response.');
    cursors.add(String(cursor));
    query.set('cursor', String(cursor));
  }
}

async function searchNbaTeams(url, env) {
  try {
    const teams = await getNbaPages('teams', new URLSearchParams(), env);
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const matches = teams.filter(team => ['East', 'West'].includes(team.conference) && team.division)
      .filter(team => `${team.full_name} ${team.name} ${team.city} ${team.abbreviation}`.toLowerCase().includes(search))
      .map(team => ({ id: team.id, sport: 'nba', name: team.full_name, abbreviation: team.abbreviation,
        crest: `https://a.espncdn.com/i/teamlogos/nba/500/${nbaEspnCode(team.abbreviation)}.png`, conference: team.conference, division: team.division }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return new Response(JSON.stringify(matches), { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.message, error.status || 502);
  }
}

function normalizeNbaGame(game, teamId, phase) {
  const home = Number(game.home_team?.id) === teamId;
  if (!home && Number(game.visitor_team?.id) !== teamId) return null;
  const opponent = home ? game.visitor_team : game.home_team;
  const status = String(game.status_state || game.status || 'unknown').toLowerCase();
  if (['canceled', 'cancelled', 'abandoned'].includes(status)) return null;
  const scheduledDate = game.date?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate || '') || !Number.isFinite(Date.parse(scheduledDate))) return null;
  const hasTime = typeof game.datetime === 'string' && /T\d{2}:\d{2}/.test(game.datetime) && Number.isFinite(Date.parse(game.datetime));
  const timeTbd = !hasTime || game.postponed === true || ['postponed', 'suspended', 'unknown'].includes(status) || /\btbd\b|\btba\b/i.test(game.status || '');
  const seasonType = phase === 'preseason' ? phase : game.season_type || (game.postseason ? 'playoffs' : game.ist_stage ? 'ist' : 'regular');
  const competition = seasonType === 'preseason' ? 'NBA Preseason' : seasonType === 'playin' ? 'NBA Play-In'
    : seasonType === 'playoffs' ? 'NBA Playoffs' : game.ist_stage ? `NBA Cup - ${game.ist_stage}` : seasonType === 'ist' ? 'NBA Cup' : 'NBA Regular Season';
  return { id: `nba-${game.id}`, sport: 'nba', utcDate: hasTime ? game.datetime : `${scheduledDate}T12:00:00Z`, scheduledDate, timeTbd,
    opponent: opponent?.full_name || 'Opponent TBC', opponentAbbreviation: opponent?.abbreviation || '',
    venue: typeof game.venue === 'string' ? game.venue : '', competition, seasonType,
    postseason: Boolean(game.postseason || ['playin', 'playoffs'].includes(seasonType)), home, status, provider: 'balldontlie' };
}

async function enrichNbaVenues(fixtures, abbreviation, season) {
  // NBA's free game schema has no arena. Match ESPN events by opponent, site,
  // and Eastern calendar date, never by array position or a team's home arena.
  const code = nbaEspnCode(abbreviation);
  if (!/^[a-z]{2,4}$/.test(code)) return fixtures;
  const easternFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const easternDate = timestamp => {
    const parts = Object.fromEntries(easternFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const schedules = await Promise.all([1, 2, 3].map(async seasonType => {
    try {
      const result = await fetchProviderJson(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${code}/schedule?season=${season + 1}&seasontype=${seasonType}`, { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MyFixtures/1.0)' }, providerScheduleCacheTtl);
      return result.ok && Array.isArray(result.payload.events) ? result.payload.events : [];
    } catch { return []; }
  }));
  const venues = new Map();
  for (const event of schedules.flat()) {
    if (!Number.isFinite(Date.parse(event.date))) continue;
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    const selected = competitors.find(entry => nbaEspnCode(entry.team?.abbreviation) === code);
    const opponent = competitors.find(entry => entry !== selected);
    if (selected && opponent && competition.venue?.fullName) {
      venues.set(`${easternDate(event.date)}|${selected.homeAway === 'home'}|${nbaEspnCode(opponent.team?.abbreviation)}`, competition.venue.fullName);
    }
  }
  return fixtures.map(fixture => {
    const venue = venues.get(`${fixture.scheduledDate}|${fixture.home}|${nbaEspnCode(fixture.opponentAbbreviation)}`);
    return venue ? { ...fixture, venue, venueProvider: 'espn' } : fixture;
  });
}

async function getNbaFixtures(url, env) {
  const teamId = Number(url.searchParams.get('team'));
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return errorResponse('A valid BALLDONTLIE NBA team id is required.', 400);
  const now = new Date();
  const defaultSeason = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const dateFrom = url.searchParams.get('dateFrom') || `${defaultSeason}-07-01`;
  const dateTo = url.searchParams.get('dateTo') || `${defaultSeason + 1}-06-30`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const season = Number(dateFrom.slice(0, 4)) - (dateFrom.slice(5, 7) < '07' ? 1 : 0);
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo || dateTo > `${season + 1}-06-30`) {
    return errorResponse('Provide a valid NBA date range within one July-to-June season.', 400);
  }
  try {
    const query = { 'team_ids[]': String(teamId), 'seasons[]': String(season), start_date: dateFrom, end_date: dateTo };
    // Omitting season_type includes regular season, Cup, Play-In and playoffs;
    // preseason must be requested separately. Complete both before responding.
    const games = await getNbaPages('games', new URLSearchParams(query), env);
    const preseason = await getNbaPages('games', new URLSearchParams({ ...query, season_type: 'preseason' }), env);
    const normalized = [...games.map(game => normalizeNbaGame(game, teamId)), ...preseason.map(game => normalizeNbaGame(game, teamId, 'preseason'))]
      .filter(fixture => fixture && fixture.scheduledDate >= dateFrom && fixture.scheduledDate <= dateTo);
    const unique = [...new Map(normalized.map(fixture => [fixture.id, fixture])).values()];
    const selectedTeam = [...games, ...preseason].flatMap(game => [game.home_team, game.visitor_team]).find(team => Number(team?.id) === teamId);
    const fixtures = (await enrichNbaVenues(unique, selectedTeam?.abbreviation, season)).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return new Response(JSON.stringify({ fixtures, results: fixtures.length, provider: 'balldontlie', venueProvider: fixtures.some(fixture => fixture.venueProvider) ? 'espn' : null, season }), { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.message, error.status || 502);
  }
}

async function fetchProviderJson(providerUrl, headers, ttlSeconds) {
  const cache = caches.default;
  const cacheKey = new Request(providerUrl);
  const cached = await cache.match(cacheKey);
  if (cached) return { ok: true, status: cached.status, payload: await cached.json(), fromCache: true };

  const response = await fetch(providerUrl, { headers, signal: AbortSignal.timeout(20000) });
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
  const allowed = url.pathname === '/api/teams' ? ['sport', 'search'] : ['sport', 'team', 'teamName', 'teamAbbreviation', 'competitions', 'dateFrom', 'dateTo'];
  const values = new URLSearchParams();
  for (const name of allowed) if (url.searchParams.has(name)) values.set(name, url.searchParams.get(name));
  values.set('__cache_schema', '3');
  url.search = values.toString();
  return new Request(url.toString(), request);
}

function validateApiQuery(url) {
  if (url.search.length > 2048) return errorResponse('Query is too long.', 400);
  const sport = url.searchParams.get('sport') || 'soccer';
  if (!['soccer', 'nfl', 'mlb', 'nba', 'nhl', 'f1'].includes(sport)) return errorResponse('Unsupported sport.', 400);
  if (url.searchParams.getAll('sport').length > 1) return errorResponse('Invalid sport.', 400);
  const limits = { search: 80, team: 32, teamName: 100, teamAbbreviation: 12, competitions: 160 };
  for (const [name, limit] of Object.entries(limits)) {
    if (url.searchParams.getAll(name).length > 1 || (url.searchParams.get(name) || '').length > limit) return errorResponse(`Invalid ${name}.`, 400);
  }
  const team = url.searchParams.get('team');
  if (url.pathname === '/api/fixtures' && team && sport !== 'f1' && !/^[1-9]\d{0,9}$/.test(team)) return errorResponse('Invalid team.', 400);
  const abbreviation = url.searchParams.get('teamAbbreviation');
  if (abbreviation && !/^[a-z0-9]{1,12}$/i.test(abbreviation)) return errorResponse('Invalid teamAbbreviation.', 400);
  for (const name of ['dateFrom', 'dateTo']) {
    const dates = url.searchParams.getAll(name);
    if (dates.length > 1 || (dates.length && (!/^\d{4}-\d{2}-\d{2}$/.test(dates[0]) || Number.isNaN(Date.parse(`${dates[0]}T00:00:00Z`)) || new Date(`${dates[0]}T00:00:00Z`).toISOString().slice(0, 10) !== dates[0]))) return errorResponse(`Invalid ${name}.`, 400);
  }
  const from = url.searchParams.get('dateFrom');
  const to = url.searchParams.get('dateTo');
  if (from && to && from > to) return errorResponse('Invalid date range.', 400);
  if (from && to && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 731 * 86400000) return errorResponse('Date range is too long.', 400);
  return null;
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

async function withApiCache(request, env, ttlSeconds, handler) {
  if (request.method !== 'GET') return handler();
  const cache = caches.default;
  const key = apiCacheKey(request);
  const cached = await cache.match(key);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-myfixtures-cache', 'HIT');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp && env.PUBLIC_API_RATE_LIMIT) {
    const { success } = await env.PUBLIC_API_RATE_LIMIT.limit({ key: `${new URL(request.url).host}:${clientIp}` });
    if (!success) return new Response(JSON.stringify({ error: 'Too many requests. Please try again shortly.' }), { status: 429, headers: { ...jsonHeaders, 'cache-control': 'no-store', 'retry-after': '60' } });
  }
  const schedule = new URL(request.url).pathname === '/api/fixtures';
  const staleUrl = new URL(key.url); staleUrl.searchParams.set('__snapshot', 'last-good');
  const staleKey = new Request(staleUrl);
  let response;
  try { response = await handler(); } catch { response = errorResponse('Schedule provider temporarily unavailable. Please retry.', 502); }
  let body;
  if (schedule && response.ok) {
    body = await response.clone().json();
    if (!Array.isArray(body.fixtures) || Object.keys(body.errors || {}).length) response = errorResponse('Invalid schedule response.', 502);
  }
  const previous = schedule && (!response.ok || body?.coverage === 'partial' || !body?.fixtures?.length) ? await cache.match(staleKey) : null;
  if (previous && (response.status >= 500 || response.status === 429 || [401, 403].includes(response.status) || body?.coverage === 'partial' || (body?.fixtures?.length === 0 && (await previous.clone().json()).fixtures?.some(g => Date.parse(g.utcDate) > Date.now())))) {
    const saved = await previous.json();
    saved.health = { ...saved.health, state: 'stale', attemptedAt: Date.now(), reason: response.status === 429 ? 'rate-limit' : [401, 403].includes(response.status) ? 'access' : body?.coverage === 'partial' ? 'partial' : 'provider' };
    return new Response(JSON.stringify(saved), { headers: { ...jsonHeaders, 'cache-control': 'no-store', 'x-myfixtures-cache': 'STALE' } });
  }
  if (schedule && response.ok) {
    const sport = new URL(request.url).searchParams.get('sport') || 'soccer';
    const coverage = body.coverage || (['soccer', 'nfl'].includes(sport) ? 'unverified' : 'published');
    body.health = { checkedAt: Date.now(), updated: Date.now(), state: coverage === 'partial' ? 'partial' : body.fixtures.length ? 'current' : 'unpublished', coverage };
    response = new Response(JSON.stringify(body), { headers: response.headers });
    if (coverage === 'partial') {
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    if (coverage !== 'partial') await cache.put(staleKey, new Response(JSON.stringify(body), { headers: { ...jsonHeaders, 'cache-control': 'public, max-age=604800' } }));
  }
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
      return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, coverage: schedules.some(matches => matches === null) || !teamFixturePayload.ok ? 'partial' : 'unverified', source: espnFixtures.length ? 'football-data+espn' : 'football-data' }), { status: 200, headers: jsonHeaders });
    }
  }

  if (teamFixturePayload.ok) {
    const footballFixtures = uniqueFixtures(teamFixtures.map(match => normalizeFootballDataMatch(match, teamId)));
    const fixtures = mergeSoccerFixtures(footballFixtures, espnFixtures);
    return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, source: espnFixtures.length ? 'football-data+espn' : 'football-data' }), { status: 200, headers: jsonHeaders });
  }

  if (espnFixtures.length) {
    const fixtures = uniqueFixtures(espnFixtures);
    return new Response(JSON.stringify({ fixtures, errors: {}, results: fixtures.length, coverage: 'partial', source: 'espn' }), { status: 200, headers: jsonHeaders });
  }

  return getTeamFixtures(teamId, dateFrom, dateTo, headers);
}

async function getNflTeams(env) {
  if (nflTeamsCache.teams.length && Date.now() - nflTeamsCache.created < nflTeamsCacheDuration) return nflTeamsCache.teams;
  if (!env.BALLDONTLIE_API_KEY) return null;
  const response = await fetch('https://api.balldontlie.io/nfl/v1/teams', {
    headers: { Authorization: env.BALLDONTLIE_API_KEY }, signal: AbortSignal.timeout(20000)
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
  const providerStatus = competition.status?.type?.name || event.status?.type?.name || '';
  const timeTbd = event.timeValid === false || competition.timeValid === false || /postpon|suspend/i.test(providerStatus);
  return {
    id: event.id,
    sport: 'nfl',
    utcDate: event.date,
    timeTbd,
    opponent: opponent?.team?.displayName || 'Opponent TBC',
    venue: competition.venue?.fullName || '',
    competition: event.week?.text ? `${seasonType} - ${event.week.text}` : seasonType,
    home: selected?.homeAway === 'home',
    status: /cancel|postpon|suspend|abandon/i.test(providerStatus) ? providerStatus.toLowerCase() : event.status?.type?.state || 'scheduled',
    provider: 'espn'
  };
}

async function getEspnNflFixtures(team, dateFrom, dateTo) {
  if (!team?.abbreviation) return [];
  const rangeStart = new Date(`${dateFrom}T00:00:00Z`);
  const season = rangeStart.getUTCMonth() < 2 ? rangeStart.getUTCFullYear() - 1 : rangeStart.getUTCFullYear();
  const responses = await Promise.all([1, 2, 3].map(type => fetch(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.abbreviation.toLowerCase()}/schedule?season=${season}&seasontype=${type}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MyFixtures/1.0)' }, signal: AbortSignal.timeout(20000)
  })));
  const payloads = await Promise.all(responses.filter(response => response.ok).map(response => response.json()));
  const events = payloads.flatMap(payload => payload.events || []);
  const games = events
    .filter((event, index, all) => all.findIndex(candidate => candidate.id === event.id) === index)
    .map(event => normalizeEspnNflGame(event, team.abbreviation))
    .filter(game => {
      const gameDate = game.utcDate.slice(0, 10);
      return gameDate >= dateFrom && gameDate <= dateTo;
    });
  games.coverage = responses.every(response => response.ok) ? 'published' : 'partial';
  return games;
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
  if (espnGames.length) return new Response(JSON.stringify({ fixtures: espnGames, results: espnGames.length, provider: 'espn', coverage: espnGames.coverage }), { status: 200, headers: jsonHeaders });
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
    headers: { Authorization: env.BALLDONTLIE_API_KEY }, signal: AbortSignal.timeout(20000)
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
  let pages = 0;
  query.set('per_page', '100');
  while (true) {
    if (++pages > 25) throw new Error('MLB schedule provider returned too many pages.');
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
    if (games.length + result.payload.data.length > 2500) throw new Error('MLB schedule provider returned too many games.');
    games.push(...result.payload.data);
    const cursor = result.payload.meta?.next_cursor;
    if (cursor == null) return games;
    if (cursors.has(String(cursor))) throw new Error('Invalid MLB pagination response.');
    cursors.add(String(cursor));
    query.set('cursor', String(cursor));
  }
}

async function getMlbFixtures(url, env, options = {}) {
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
    const excluded = new Set(options.history ? [] : ['final', 'completed', 'canceled', 'cancelled', 'abandoned']);
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
        timeTbd: !/T\d{2}:\d{2}/.test(game.date) || /tbd|tba|postpon|suspend|^ppd$/i.test(`${game.status || ''} ${game.status_state || ''}`),
        scheduledDate: game.date.slice(0, 10),
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
  let pages = 0;
  query.set('per_page', '100');
  while (true) {
    if (++pages > 25) throw new Error('F1 schedule provider returned too many pages.');
    const result = await fetchProviderJson(`https://api.balldontlie.io/f1/v1/${endpoint}?${query}`, { Authorization: env.BALLDONTLIE_API_KEY }, providerScheduleCacheTtl);
    if (!result.ok) {
      const providerMessage = result.payload?.message || result.payload?.error;
      const error = new Error(result.status === 401 || result.status === 403
        ? 'F1 access denied. Check BALLDONTLIE_API_KEY and F1 ALL-STAR or GOAT access for session times.'
        : result.status === 429
          ? 'BALLDONTLIE F1 rate limit reached. Please try again shortly.'
          : `BALLDONTLIE F1 schedule request failed (${result.status})${providerMessage ? `: ${providerMessage}` : '.'}`);
      error.status = result.status >= 400 && result.status <= 599 ? result.status : 502;
      throw error;
    }
    if (!Array.isArray(result.payload.data)) throw new Error('Invalid F1 schedule response.');
    if (rows.length + result.payload.data.length > 2500) throw new Error('F1 schedule provider returned too many records.');
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
    headers: { 'User-Agent': 'MyFixtures/1.0' }, signal: AbortSignal.timeout(20000)
  })));
  const payloads = await Promise.all(responses.map(async response => {
    if (!response.ok) throw new Error(`Jolpica F1 returned ${response.status}`);
    return response.json();
  }));
  if (payloads.some(payload => !payload.MRData?.RaceTable || !Array.isArray(payload.MRData.RaceTable.Races))) {
    throw new Error('Jolpica returned an invalid F1 schedule response');
  }
  return payloads.flatMap(payload => payload.MRData.RaceTable.Races)
    .flatMap(race => [
      ['qualifying', 'Qualifying', race.Qualifying],
      ['sprint-qualifying', 'Sprint Qualifying', race.SprintQualifying || race.SprintShootout],
      ['sprint', 'Sprint', race.Sprint],
      ['race', 'Race', race]
    ].flatMap(([sessionType, label, session]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(session?.date || '') || session.date < dateFrom || session.date > dateTo) return [];
      const utcDate = `${session.date}T${session.time || '12:00:00Z'}`;
      if (!Number.isFinite(Date.parse(utcDate))) return [];
      return [{
        id: `f1-jolpica-${race.season}-${race.round}${sessionType === 'race' ? '' : `-${sessionType}`}`,
        sport: 'f1', sessionType, utcDate, scheduledDate: session.date, timeTbd: !session.time,
        opponent: race.raceName || 'Grand Prix', title: `${race.raceName || 'Grand Prix'} - ${label}`,
        venue: race.Circuit?.circuitName || '', competition: 'Formula 1', status: 'scheduled', provider: 'jolpica'
      }];
    }))
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

function f1SessionType(value) {
  const type = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  return { race: 'race', qualifying: 'qualifying', sprint: 'sprint', sprintrace: 'sprint', sprintqualifying: 'sprint-qualifying', sprintshootout: 'sprint-qualifying' }[type];
}

const f1SessionLabel = { race: 'Race', qualifying: 'Qualifying', sprint: 'Sprint', 'sprint-qualifying': 'Sprint Qualifying' };

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
      const query = new URLSearchParams();
      upcoming.slice(offset, offset + 20).forEach(event => query.append('event_ids[]', String(event.id)));
      sessions.push(...await getF1Pages('sessions', query, env));
    }
    const fixtures = [...new Map(sessions.filter(session => f1SessionType(session.type) && session.date && Number.isFinite(Date.parse(session.date)) && session.date.slice(0, 10) >= dateFrom && session.date.slice(0, 10) <= dateTo && !excluded.has(String(session.status_state || session.status).toLowerCase())).map(session => {
      const event = session.event || upcoming.find(event => event.id === session.event_id) || {};
      const sessionType = f1SessionType(session.type);
      return [session.id, { id: `f1-${session.id}`, sport: 'f1', sessionType, utcDate: session.date, scheduledDate: session.date.slice(0, 10), opponent: event.name || 'Grand Prix', title: `${event.name || 'Grand Prix'} - ${f1SessionLabel[sessionType]}`, venue: event.circuit?.name || event.location || '', competition: 'Formula 1', status: session.status_state || session.status || 'unknown', provider: 'balldontlie' }];
    })).values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return new Response(JSON.stringify({ fixtures, results: fixtures.length, provider: 'balldontlie' }), { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error.status ? error.message : 'BALLDONTLIE F1 schedule is temporarily unavailable. Please try again later.', error.status || 502);
  }
}

export class CalendarStore extends LivingCalendarStore {
  constructor(ctx, env) {
    super(ctx, env, async (team, range) => {
      const url = new URL('https://myfixtures.internal/api/fixtures');
      url.search = new URLSearchParams({ sport: team.sport, team: String(team.id), teamName: team.name,
        teamAbbreviation: team.abbreviation, competitions: team.competitions.join(','), dateFrom: range.from, dateTo: range.to });
      const loader = { soccer: getSoccerFixtures, nfl: getNflFixtures, nba: getNbaFixtures, nhl: getNhlFixtures, f1: getF1Fixtures, mlb: getMlbFixtures }[team.sport];
      const response = await loader(url, env, { history: true });
      if (!response.ok) throw Object.assign(new Error('Schedule provider unavailable'), { status: response.status });
      const data = await response.json();
      if (!Array.isArray(data.fixtures) || Object.keys(data.errors || {}).length) throw new Error('Incomplete schedule response');
      // Soccer/NFL can supplement partial upstream feeds. Missing entries in
      // those feeds must not be interpreted as cancellations.
      return { ...data, complete: ['nhl', 'nba', 'mlb', 'f1'].includes(team.sport) };
    });
  }
}

// Pages reference app.css, app.js and calendar-ui.mjs with ?v=<content hash> (see scripts/stamp-assets.mjs),
// so those URLs never change content and can be cached for a year. Everything else, including HTML and
// unversioned module imports, revalidates on each use and is answered with a cheap 304 when unchanged.
const versionedAssetPaths = new Set(['/app.css', '/app.js', '/calendar-ui.mjs']);
function assetCacheControl(url, response) {
  if (response.ok && versionedAssetPaths.has(url.pathname) && /^[a-f0-9]{10}$/.test(url.searchParams.get('v') || '')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

async function routeAppRequest(request, env) {
    const calendarResponse = routeCalendarRequest(request, env);
    if (calendarResponse) return calendarResponse;
    const url = new URL(request.url);
    if (url.pathname !== '/api/fixtures' && url.pathname !== '/api/teams') {
      if (!publicAssetPaths.has(url.pathname)) return errorResponse('Not found.', 404);
      if (!['GET', 'HEAD'].includes(request.method)) return errorResponse('Method not allowed.', 405);
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set('cache-control', assetCacheControl(url, assetResponse));
      return new Response(assetResponse.body, { status: assetResponse.status, headers });
    }

    if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
    const invalidQuery = validateApiQuery(url);
    if (invalidQuery) return invalidQuery;

    const sport = url.searchParams.get('sport') || 'soccer';
    if (sport === 'nhl') {
      return withApiCache(request, env, url.pathname === '/api/teams' ? teamSearchCacheTtl : fixtureCacheTtl,
        () => url.pathname === '/api/teams' ? searchNhlTeams(url) : getNhlFixtures(url));
    }
    if (sport === 'nba') {
      return withApiCache(request, env, url.pathname === '/api/teams' ? teamSearchCacheTtl : fixtureCacheTtl,
        () => url.pathname === '/api/teams' ? searchNbaTeams(url, env) : getNbaFixtures(url, env));
    }
    if (sport === 'f1') {
      if (url.pathname === '/api/teams') return new Response(JSON.stringify([]), { headers: jsonHeaders });
      return withApiCache(request, env, fixtureCacheTtl, () => getF1Fixtures(url, env));
    }
    if (url.pathname === '/api/teams') {
      return withApiCache(request, env, teamSearchCacheTtl, () => sport === 'nfl' ? searchNflTeams(url, env) : sport === 'mlb' ? searchMlbTeams(url, env) : searchSoccerTeams(url, env));
    }
    return withApiCache(request, env, fixtureCacheTtl, () => sport === 'nfl' ? getNflFixtures(url, env) : sport === 'mlb' ? getMlbFixtures(url, env) : getSoccerFixtures(url, env));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return new Response(null, { status: 308, headers: { location: url.toString(), 'cache-control': 'no-store' } });
    }
    return secureResponse(await routeAppRequest(request, env));
  }
};
