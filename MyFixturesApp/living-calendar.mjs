import { localDate, gamePhase, competitionKey, competitionName, confirmedOpponent, matchesPreferences } from './schedule-common.mjs';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const SPORTS = ['soccer', 'nfl', 'mlb', 'nba', 'nhl', 'f1'];
const TOKEN = /^[a-f0-9]{32}$/;
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max = 100) => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const teamKey = team => `${team.sport}:${team.id}`;
export const cancelled = fixture => /cancel|abandon|^cncl$/i.test(fixture.status || '');
export const postponed = fixture => /postpon|suspend|^ppd$|^susp$/i.test(fixture.status || '');
export const duration = sport => ['nfl', 'mlb'].includes(sport) ? 180 : ['nba', 'nhl'].includes(sport) ? 150 : 120;

export function validateConfig(input) {
  if (!input || !Array.isArray(input.teams) || !input.teams.length || input.teams.length > 12) throw fail('Choose between 1 and 12 teams or championships.');
  const teams = input.teams.map(team => {
    if (!team || !SPORTS.includes(team.sport)) throw fail('Choose a supported sport.');
    const id = team.sport === 'f1' ? 'f1' : Number(team.id);
    if (team.sport !== 'f1' && (!Number.isSafeInteger(id) || id <= 0)) throw fail('Invalid team identifier.');
    const name = team.sport === 'f1' ? 'Formula 1' : clean(team.name);
    if (!name) throw fail('A team name is required.');
    return { id, sport: team.sport, name, abbreviation: clean(team.abbreviation, 8).replace(/[^a-z0-9]/gi, ''),
      competitions: Array.isArray(team.competitions) ? team.competitions.filter(code => /^[A-Z0-9]{1,5}$/.test(code)).slice(0, 15) : [] };
  });
  const timeZone = clean(input.timeZone || 'America/New_York', 60);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw fail('Choose a valid time zone.'); }
  const reminder = Number(input.reminder ?? 30);
  if (![0, 15, 30, 60, 1440].includes(reminder)) throw fail('Choose a supported reminder.');
  const venueFilter = input.venueFilter || 'all';
  if (!['all', 'home', 'away'].includes(venueFilter)) throw fail('Choose all, home or away games.');
  const dateFrom = input.dateFrom || '', dateTo = input.dateTo || '';
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if ([dateFrom, dateTo].some(date => date && !validDate(date)) || (dateFrom && dateTo && dateFrom > dateTo)) throw fail('Choose a valid date range with the start before the end.');
  if (input.competitionFilters !== undefined && (!Array.isArray(input.competitionFilters) || input.competitionFilters.length > 50 || input.competitionFilters.some(code => typeof code !== 'string' || code.length > 150 || !/^(soccer|nfl|mlb|nba|nhl|f1):[^\x00-\x1f]+$/.test(code)))) throw fail('Choose valid competitions.');
  return { name: clean(input.name || 'MyFixtures Living Calendar', 80), teams: [...new Map(teams.map(team => [teamKey(team), team])).values()],
    timeZone, includeCompleted: input.includeCompleted === true, includePreseason: input.includePreseason !== false,
    includePostseason: input.includePostseason !== false, reminder, venueFilter, dateFrom, dateTo,
    competitionFilters: [...new Set(input.competitionFilters || [])] };
}

export function seasonRange(sport, now = Date.now()) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  if (['mlb', 'f1'].includes(sport)) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const start = year - (date.getUTCMonth() < 6 ? 1 : 0);
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

export function phase(fixture) {
  return gamePhase(fixture);
}

export function scheduleChanges(previous, fixtures, team, history = [], now = Date.now(), initialized = true) {
  const identity = f => `${f.provider || ''}:${f.id}`;
  const oldGames = new Map(previous.map(f => [identity(f), f]));
  const view = f => ({ start: f.utcDate, timeTbd: Boolean(f.timeTbd), venue: clean(f.venue, 120), opponent: clean(f.opponent, 100),
    status: cancelled(f) ? 'cancelled' : postponed(f) ? 'postponed' : 'scheduled' });
  const changes = [];
  if (initialized) for (const game of fixtures) {
    const old = oldGames.get(identity(game)), before = old ? view(old) : null, after = view(game);
    const fields = old ? Object.keys(after).filter(key => before[key] !== after[key]) : ['added'];
    if (!fields.length) continue;
    changes.push({ id: `${identity(game)}:${now}`, at: now, sport: team.sport, fixtureId: String(game.id),
      title: clean(team.sport === 'f1' ? game.title || game.opponent : game.home ? `${team.name} v ${game.opponent}` : `${game.opponent} v ${team.name}`, 180),
      competition: clean(game.competition, 120), postseason: phase(game) === 'postseason', fields, before, after });
  }
  return [...changes, ...history].filter(change => change.at >= now - 90 * DAY).sort((a, b) => b.at - a.at).slice(0, 80);
}

export function teamHealth(team, snapshot, now = Date.now()) {
  const range = seasonRange(team.sport, now);
  const current = snapshot?.range?.from === range.from && snapshot?.range?.to === range.to;
  const games = (snapshot?.fixtures || []).filter(f => { const day = f.scheduledDate || f.utcDate.slice(0, 10); return day >= range.from && day <= range.to; });
  const state = snapshot?.error ? (snapshot.updated ? 'stale' : 'unavailable') : !snapshot?.updated ? 'preparing' : !current ? 'season-pending' : now - snapshot.updated > 2 * HOUR ? 'stale' : snapshot.coverage === 'partial' ? 'partial' : !games.length ? 'unpublished' : 'current';
  return { team: teamKey(team), name: team.name, sport: team.sport, state, checkedAt: snapshot?.checkedAt || snapshot?.updated || null,
    updated: snapshot?.updated || null, nextCheck: snapshot?.next || null, coverage: snapshot?.coverage || 'unverified',
    reason: snapshot?.errorReason || null, season: range, games: games.length, unconfirmed: games.filter(g => g.timeTbd || !confirmedOpponent({ ...g, sport: team.sport })).length };
}

export function mergeTeamSnapshot(previous, fixtures, range, complete, now = Date.now()) {
  if (!Array.isArray(fixtures) || fixtures.some(f => !f.id || !Number.isFinite(Date.parse(f.utcDate)) || !f.opponent)) throw fail('Schedule provider returned invalid games.', 502);
  // An unexpectedly empty response must not withdraw an entire published season.
  if (!fixtures.length && previous.some(f => Date.parse(f.utcDate) > now && !cancelled(f) && f.utcDate.slice(0, 10) >= range.from && f.utcDate.slice(0, 10) <= range.to)) throw fail('The provider returned an unexpectedly empty schedule. Keeping the last update.', 502);
  const result = new Map(previous.filter(f => Date.parse(f.utcDate) > now - 400 * DAY).map(f => [String(f.id), f]));
  const current = new Set(fixtures.map(f => String(f.id)));
  for (const fixture of fixtures) result.set(String(fixture.id), { ...fixture, missingCount: 0 });
  for (const [id, old] of result) {
    const date = old.scheduledDate || old.utcDate.slice(0, 10);
    if (!current.has(id) && complete && date >= range.from && date <= range.to && Date.parse(old.utcDate) > now && !cancelled(old)) {
      const missingCount = (old.missingCount || 0) + 1;
      result.set(id, { ...old, missingCount, ...(missingCount >= 2 ? { status: 'cancelled', changeNote: 'Removed from the published schedule.' } : {}) });
    }
  }
  return [...result.values()];
}

function nameIdentity(name) { return clean(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(fc|afc|cf)\b/g, '').replace(/[^a-z0-9]/g, ''); }

export function collectGames(config, snapshots) {
  const games = new Map();
  const aliases = new Map();
  for (const team of config.teams) {
    for (const fixture of snapshots[teamKey(team)]?.fixtures || []) {
      const homeName = fixture.home ? team.name : fixture.opponent;
      const awayName = fixture.home ? fixture.opponent : team.name;
      const sourceKey = `${team.sport}:${fixture.provider === 'espn' ? 'espn:' : ''}${fixture.id}`;
      // Cross-provider soccer duplicates can have different IDs. Only match the
      // same home/away pair at the same timestamp; never collapse doubleheaders.
      const alias = `${team.sport}|${fixture.utcDate}|${nameIdentity(homeName)}|${nameIdentity(awayName)}`;
      const aliasKey = aliases.get(alias);
      const crossProviderMatch = team.sport === 'soccer' && aliasKey && games.get(aliasKey)?.provider !== fixture.provider;
      const key = games.has(sourceKey) ? sourceKey : crossProviderMatch ? aliasKey : sourceKey;
      const existing = games.get(key);
      const selectedTeams = [...new Set([...(existing?.selectedTeams || []), teamKey(team)])];
      const selectedSides = [...new Set([...(existing?.selectedSides || []), fixture.home ? 'home' : 'away'])];
      if (!existing) games.set(key, { ...fixture, sport: team.sport, key, selectedTeams, selectedSides, homeName, awayName,
        title: team.sport === 'f1' ? fixture.title || fixture.opponent : `${homeName} v ${awayName}` });
      else { existing.selectedTeams = selectedTeams; existing.selectedSides = selectedSides; if (cancelled(fixture)) existing.status = fixture.status; }
      aliases.set(alias, key);
    }
  }
  return [...games.values()].sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
}

export function included(game, config, now = Date.now()) {
  if (!matchesPreferences(game, config)) return false;
  if (!config.includePreseason && phase(game) === 'preseason') return false;
  if (!config.includePostseason && phase(game) === 'postseason') return false;
  const range = seasonRange(game.sport, now);
  const date = game.scheduledDate || game.utcDate.slice(0, 10);
  if (date < range.from || date > range.to) return false;
  if (!config.includeCompleted && Date.parse(game.utcDate) + duration(game.sport) * 60000 < now && !game.timeTbd) return false;
  if (!config.includeCompleted && game.timeTbd && date < localDate(now, config.timeZone)) return false;
  return true;
}

export function reconcileEvents(previous, games, config, now = Date.now()) {
  const next = { ...previous };
  const eligible = new Set();
  const update = (key, content) => {
    const old = previous[key];
    const signature = JSON.stringify(content);
    next[key] = old?.signature === signature ? old : { ...content, signature, sequence: old ? old.sequence + 1 : 0, modified: now, created: old?.created || now };
  };
  for (const game of games.filter(game => included(game, config, now))) {
    if (game.timeTbd || postponed(game) || !confirmedOpponent(game)) continue;
    eligible.add(game.key);
    const content = { title: `${game.title} - ${game.competition}`, start: game.utcDate, end: new Date(Date.parse(game.utcDate) + duration(game.sport) * 60000).toISOString(),
      venue: game.venue || '', status: cancelled(game) ? 'CANCELLED' : 'CONFIRMED', reminder: config.reminder,
      description: `${game.competition}. ${game.changeNote || ''} Calendar duration is estimated at ${duration(game.sport)} minutes.`.trim() };
    if (content.status !== 'CANCELLED' || previous[game.key]) update(game.key, content);
  }
  for (const [key, old] of Object.entries(previous)) {
    if (!eligible.has(key) && old.status !== 'CANCELLED') {
      const game = games.find(game => game.key === key);
      update(key, { title: old.title, start: old.start, end: old.end, venue: old.venue, status: 'CANCELLED', reminder: 0,
        description: game && (game.timeTbd || postponed(game)) ? 'Start time is unconfirmed or postponed. This entry is withdrawn until a new time is confirmed.' : 'This event is no longer included in your calendar selection.' });
    }
    if (Date.parse(old.end) < now - 400 * DAY) delete next[key];
  }
  return next;
}

export const escapeIcs = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function foldLine(line) {
  const encoder = new TextEncoder();
  let result = '', size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) { result += '\r\n '; size = 1; }
    result += char; size += bytes;
  }
  return result;
}
async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

export async function calendarText(subscription) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyFixtures//Living Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(subscription.config.name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const [key, event] of Object.entries(subscription.events || {}).sort((a, b) => a[1].start.localeCompare(b[1].start) || a[0].localeCompare(b[0]))) {
    lines.push('BEGIN:VEVENT', `UID:${await digest(key)}@myfixtures`, `SEQUENCE:${event.sequence}`, `DTSTAMP:${stamp(event.modified)}`, `CREATED:${stamp(event.created)}`, `LAST-MODIFIED:${stamp(event.modified)}`,
      `DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`, `SUMMARY:${escapeIcs(event.title)}`, `LOCATION:${escapeIcs(event.venue)}`, `DESCRIPTION:${escapeIcs(event.description)}`, `STATUS:${event.status}`, 'TRANSP:TRANSPARENT');
    if (event.reminder && event.status !== 'CANCELLED') lines.push('BEGIN:VALARM', `TRIGGER:-PT${event.reminder}M`, 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(event.title)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// One durable coordinator shares team snapshots and paces refreshes across all
// subscriptions. No browser needs to remain open for background updates.
export class LivingCalendarStore {
  constructor(ctx, env, loader) { this.ctx = ctx; this.storage = ctx.storage; this.loader = loader; }

  async saveRecord(record) {
    const { events, ...metadata } = record;
    const entries = Object.entries(events || {});
    const chunks = {};
    for (let i = 0; i < entries.length; i += 40) chunks[`ledger:${record.id}:${String(i / 40).padStart(4, '0')}`] = Object.fromEntries(entries.slice(i, i + 40));
    // Keep each storage value below Durable Objects' per-value limit.
    await this.storage.transaction(async txn => {
      for (const key of (await txn.list({ prefix: `ledger:${record.id}:` })).keys()) if (!(key in chunks)) await txn.delete(key);
      await txn.put({ [`sub:${record.id}`]: metadata, ...chunks });
    });
  }

  async loadRecord(id) {
    const metadata = await this.storage.get(`sub:${id}`);
    if (!metadata) return null;
    return { ...metadata, events: Object.assign({}, ...[...(await this.storage.list({ prefix: `ledger:${id}:` })).values()]) };
  }

  async wake(at = Date.now() + 500) {
    const alarm = await this.storage.getAlarm();
    if (!alarm || alarm > at) await this.storage.setAlarm(at);
  }

  async loadTeam(key) {
    const record = await this.storage.get(key);
    if (!record?.chunkedFixtures) return record;
    return { ...record, fixtures: [...(await this.storage.list({ prefix: `snapshot:${key}:` })).values()].flat() };
  }

  async saveTeam(key, record, historyKey, history) {
    const { fixtures, ...metadata } = record;
    const chunks = {};
    for (let i = 0; i < fixtures.length; i += 80) chunks[`snapshot:${key}:${String(i / 80).padStart(4, '0')}`] = fixtures.slice(i, i + 80);
    await this.storage.transaction(async txn => {
      for (const oldKey of (await txn.list({ prefix: `snapshot:${key}:` })).keys()) if (!(oldKey in chunks)) await txn.delete(oldKey);
      await txn.put({ [key]: { ...metadata, chunkedFixtures: true }, [historyKey]: history, ...chunks });
    });
  }

  async registerTeams(config) {
    for (const team of config.teams) {
      const key = `team:${teamKey(team)}`;
      const old = await this.storage.get(key);
      const requestedSeason = seasonRange(team.sport).from;
      await this.storage.put(key, { ...old, team, next: old?.requestedSeason !== requestedSeason ? 0 : old?.next || 0, requestedSeason, activeUntil: Date.now() + 90 * DAY });
    }
    await this.wake();
  }

  async releaseTeams(previous, current) {
    const remaining = new Set((current?.teams || []).map(teamKey));
    const removed = previous.teams.filter(team => !remaining.has(teamKey(team)));
    if (!removed.length) return;
    const subscriptions = [...(await this.storage.list({ prefix: 'sub:' })).values()].filter(sub => !sub.revoked);
    for (const team of removed) {
      if (subscriptions.some(sub => sub.config.teams.some(other => teamKey(other) === teamKey(team)))) continue;
      const key = `team:${teamKey(team)}`;
      const snapshot = await this.storage.get(key);
      if (snapshot) await this.storage.put(key, { ...snapshot, activeUntil: 0 });
    }
    await this.wake();
  }

  async alarm() {
    // Set a recovery alarm before any network request (including isolate resets).
    await this.storage.setAlarm(Date.now() + 60000);
    const now = Date.now();
    const teams = [...(await this.storage.list({ prefix: 'team:' })).entries()].filter(([, t]) => t.activeUntil > now);
    const cooldown = await this.storage.get('providerCooldown') || 0;
    const due = teams.filter(([, t]) => t.next <= now && (!['nba', 'mlb', 'nfl', 'f1'].includes(t.team.sport) || cooldown <= now)).sort((a, b) => a[1].next - b[1].next);
    if (!due.length) {
      if (!teams.length) { await this.storage.deleteAlarm(); return; }
      await this.storage.setAlarm(Math.max(now + 1000, Math.min(...teams.map(([, t]) => Math.max(t.next, ['nba', 'mlb', 'nfl', 'f1'].includes(t.team.sport) ? cooldown : 0)))));
      return;
    }
    const [key] = due[0];
    const record = await this.loadTeam(key);
    const range = seasonRange(record.team.sport, now);
    if (['nba', 'mlb', 'nfl', 'f1'].includes(record.team.sport)) await this.storage.put('providerCooldown', now + 65000);
    try {
      const data = await this.loader(record.team, range);
      const fixtures = mergeTeamSnapshot(record.fixtures || [], data.fixtures, range, data.complete === true, now);
      const historyKey = `history:${teamKey(record.team)}`;
      const history = scheduleChanges(record.fixtures || [], fixtures, record.team, await this.storage.get(historyKey) || [], now, Boolean(record.updated));
      const latest = await this.storage.get(key);
      await this.saveTeam(key, { ...latest, fixtures, updated: now, checkedAt: now, range,
        coverage: data.coverage || (data.complete ? 'published' : 'unverified'), error: null, errorReason: null, failures: 0, next: now + HOUR }, historyKey, history);
    } catch (error) {
      const latest = await this.storage.get(key);
      const failures = (latest.failures || 0) + 1;
      const errorReason = error.status === 429 ? 'rate-limit' : [401, 403].includes(error.status) ? 'access' : /timeout/i.test(error.name || '') ? 'timeout' : 'provider';
      await this.storage.put(key, { ...latest, checkedAt: now, error: 'Schedule update delayed. Retrying automatically.', errorReason, failures, next: now + Math.min(15 * 60000, 65000 * failures) });
    }
    await this.storage.setAlarm(Date.now() + 1000);
  }

  async readBody(request) {
    if (!request.headers.get('content-type')?.includes('application/json')) throw fail('Send JSON.', 415);
    if (Number(request.headers.get('content-length') || 0) > 16384) throw fail('Calendar settings are too large.', 413);
    const reader = request.body?.getReader();
    if (!reader) throw fail('Calendar settings are required.');
    let bytes = 0, text = ''; const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 16384) { await reader.cancel(); throw fail('Calendar settings are too large.', 413); }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); } catch { throw fail('Invalid JSON.'); }
  }

  async snapshot(record) {
    const snapshots = {};
    for (const team of record.config.teams) snapshots[teamKey(team)] = await this.loadTeam(`team:${teamKey(team)}`);
    const health = record.config.teams.map(t => teamHealth(t, snapshots[teamKey(t)]));
    const pending = record.config.teams.filter(t => { const s = snapshots[teamKey(t)]; return !s?.updated || s.range?.from !== seasonRange(t.sport).from; }).map(t => t.name);
    const delayed = record.config.teams.filter(t => snapshots[teamKey(t)]?.error || Date.now() - (snapshots[teamKey(t)]?.updated || 0) > 2 * HOUR).map(t => t.name);
    const games = collectGames(record.config, snapshots);
    const histories = await Promise.all(record.config.teams.map(t => this.storage.get(`history:${teamKey(t)}`)));
    const changes = [...new Map(histories.flatMap(h => h || []).filter(h => h.at >= record.created && h.at > Date.now() - 90 * DAY).map(h => [`${h.sport}:${h.id}`, h])).values()].sort((a, b) => b.at - a.at).slice(0, 80);
    const competitions = [...new Map(games.map(g => [competitionKey(g), { key: competitionKey(g), name: competitionName(g), sport: g.sport }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { snapshots, pending, delayed, games, health, changes, competitions };
  }

  async fetch(request) {
    // Read streams in their own request context, never in a previous request's
    // promise chain. The Durable Object input gate serializes record mutations.
    let body;
    if (['POST', 'PUT'].includes(request.method)) {
      let timeout;
      try {
        body = await Promise.race([this.readBody(request), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(fail('Calendar settings took too long to arrive.', 408)), 5000);
        })]);
      } catch (error) { return json({ error: error.status ? error.message : 'Unable to read calendar settings.' }, error.status || 400); }
      finally { clearTimeout(timeout); }
    }
    return this.ctx.blockConcurrencyWhile(() => this.handleFetch(request, body));
  }

  async handleFetch(request, body) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/calendars' && request.method === 'POST') {
        // Bound anonymous creation without retaining raw IP addresses.
        const bucket = `limit:${await digest(request.headers.get('cf-connecting-ip') || 'local')}:${Math.floor(Date.now() / HOUR)}`;
        const used = await this.storage.get(bucket) || 0;
        if (used >= 20) return json({ error: 'Too many new calendars. Try again in an hour.' }, 429);
        const config = validateConfig(body);
        const id = token(), editToken = token();
        const record = { id, config, tokenHash: await digest(editToken), events: {}, revision: 1, created: Date.now(), revoked: false };
        await this.saveRecord(record);
        await this.storage.put(bucket, used + 1);
        // Drop expired creation counters; no client identifiers are kept long term.
        for (const key of (await this.storage.list({ prefix: 'limit:' })).keys()) if (Number(key.split(':').at(-1)) < Math.floor(Date.now() / HOUR) - 1) await this.storage.delete(key);
        await this.registerTeams(config);
        return json({ id, editToken, revision: 1, config }, 201);
      }
      const match = url.pathname.match(/^\/(?:api\/calendars\/([a-f0-9]{32})|calendar\/([a-f0-9]{32})\.ics)$/);
      if (!match) return json({ error: 'Calendar not found.' }, 404);
      const id = match[1] || match[2];
      let record = await this.loadRecord(id);
      if (!record) return json({ error: 'Calendar not found.' }, 404);
      const feed = Boolean(match[2]);
      if (feed && !['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
      if (!feed && ['PUT', 'DELETE'].includes(request.method)) {
        const previousConfig = record.config;
        const secret = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        if (!TOKEN.test(secret) || await digest(secret) !== record.tokenHash) return json({ error: 'This calendar requires its private management link.' }, 403);
        if (request.method === 'DELETE') {
          record = { ...record, revoked: true, revision: record.revision + 1, events: reconcileEvents(record.events, [], record.config) };
        } else {
          if (record.revoked) return json({ error: 'This subscription has been stopped. Create a new calendar.' }, 409);
          if (body.revision !== record.revision) return json({ error: 'Settings changed elsewhere. Reload before saving.' }, 409);
          record = { ...record, config: validateConfig(body), revision: record.revision + 1 };
          await this.registerTeams(record.config);
        }
        await this.saveRecord(record);
        await this.releaseTeams(previousConfig, record.revoked ? null : record.config);
        return json({ id, config: record.config, revision: record.revision, revoked: record.revoked });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, PUT, DELETE' });
      if (!record.revoked) await this.registerTeams(record.config);
      const data = await this.snapshot(record);
      // Publish only after all selected teams have an initial snapshot. Later
      // failures retain each team's last successful snapshot and event history.
      if (!data.pending.length && !record.revoked) {
        record.events = reconcileEvents(record.events, data.games, record.config);
        await this.saveRecord(record);
      }
      if (!feed) return json({ id, config: record.config, revision: record.revision, revoked: record.revoked,
        ready: !data.pending.length && !record.revoked, pending: data.pending, delayed: data.delayed,
        health: data.health, changes: record.revoked ? [] : data.changes, competitions: data.competitions,
        updated: data.pending.length ? null : Math.min(...Object.values(data.snapshots).map(t => t.updated)),
        games: record.revoked ? [] : data.games.filter(g => included(g, record.config)), refreshSeconds: data.pending.length ? 15 : 300 });
      if (data.pending.length && !Object.keys(record.events).length && !record.revoked) return json({ error: 'Your calendar is preparing its first schedules. Please retry shortly.' }, 503, { 'retry-after': '60' });
      const feedText = await calendarText(record);
      const etag = `"${await digest(feedText)}"`;
      const headers = { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="myfixtures.ics"',
        'cache-control': 'private, max-age=300, must-revalidate', 'etag': etag, 'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*', 'x-myfixtures-delayed': String(data.delayed.length) };
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      return new Response(request.method === 'HEAD' ? null : feedText, { headers });
    } catch (error) { return json({ error: error.status ? error.message : 'Calendar service temporarily unavailable. Please retry.' }, error.status || 503); }
  }
}

export function routeCalendarRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/calendars') && !url.pathname.startsWith('/calendar/')) return null;
  if (!env.CALENDARS) return json({ error: 'Living Calendar storage is not configured.' }, 503);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Use the calendar website to change settings.' }, 403);
  }
  return env.CALENDARS.get(env.CALENDARS.idFromName('living-calendar-v1')).fetch(request);
}
