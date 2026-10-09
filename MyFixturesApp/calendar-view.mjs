import { localDate, gamePhase, competitionName, competitionKey, confirmedOpponent } from './schedule-common.mjs';
export { gamePhase, competitionName, competitionKey };
export const gameMinutes = (sport, sessionType = 'race') => sport === 'f1' ? ({ qualifying: 60, sprint: 45, 'sprint-qualifying': 45 }[sessionType] || 120) : ['mlb', 'nfl'].includes(sport) ? 180 : ['nba', 'nhl'].includes(sport) ? 150 : 120;
export function dateKey(value, timeZone) {
  return localDate(value, timeZone);
}
export function gameDate(game, zone) { return game.timeTbd && game.scheduledDate ? game.scheduledDate : dateKey(game.utcDate, zone); }
export function conflictKeys(games) {
  const active = games.filter(g => !g.timeTbd && confirmedOpponent(g) && !/cancel|abandon|postpon|suspend|^ppd$|^cncl$/i.test(g.status || '')).toSorted((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  const conflicts = new Set();
  for (let i = 0; i < active.length; i++) {
    const end = Date.parse(active[i].utcDate) + gameMinutes(active[i].sport, active[i].sessionType) * 60000;
    for (let j = i + 1; j < active.length && Date.parse(active[j].utcDate) < end; j++) {
      if (active[i].key !== active[j].key) { conflicts.add(active[i].key); conflicts.add(active[j].key); }
    }
  }
  return conflicts;
}

export function groupWeekSeries(games) {
  const groups = [], lastByTeam = new Map();
  const identity = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const game of [...games].sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))) {
    if (game.sport !== 'mlb' || !confirmedOpponent(game)) { groups.push({ key: game.key, games: [game] }); continue; }
    const home = identity(game.homeName), away = identity(game.awayName);
    if (!home || !away) { groups.push({ key: game.key, games: [game] }); continue; }
    const pair = [home, away].sort().join('|');
    const candidate = lastByTeam.get(home);
    const previous = candidate?.games.at(-1);
    const gap = previous ? Date.parse(game.utcDate) - Date.parse(previous.utcDate) : Infinity;
    const sameSite = gamePhase(game) === 'postseason' || previous?.homeName === game.homeName;
    const continuation = candidate && candidate === lastByTeam.get(away) && candidate.pair === pair && gamePhase(previous) === gamePhase(game) && sameSite && gap >= 0 && gap <= 4 * 86400000;
    const group = continuation ? candidate : { key: game.key, pair, games: [] };
    if (!continuation) groups.push(group);
    group.games.push(game);
    lastByTeam.set(home, group); lastByTeam.set(away, group);
  }
  return groups;
}

export function googleGameUrl(game, now = Date.now()) {
  if (game.timeTbd || !confirmedOpponent(game) || /cancel|abandon|postpon|suspend|^ppd$|^cncl$/i.test(game.status || '') || Date.parse(game.utcDate) <= now) return null;
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const query = new URLSearchParams({ action: 'TEMPLATE', text: `${game.title} - ${game.competition}`, dates: `${stamp(game.utcDate)}/${stamp(Date.parse(game.utcDate) + gameMinutes(game.sport, game.sessionType) * 60000)}`, details: `One-time copy. ${game.competition}. Duration estimated at ${gameMinutes(game.sport, game.sessionType)} minutes.`, location: game.venue || '' });
  return `https://calendar.google.com/calendar/render?${query}`;
}

export function describeChange(change, timeZone) {
  const date = value => new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  if (change.fields.includes('added')) return change.postseason ? 'New postseason matchup announced.' : 'New game added to the published schedule.';
  const messages = [], { before, after } = change;
  if (change.fields.includes('status')) messages.push(after.status === 'cancelled' ? 'Cancelled or removed from the published schedule.' : after.status === 'postponed' ? 'Postponed; awaiting a confirmed replacement time.' : 'Returned to the schedule.');
  if (change.fields.includes('timeTbd')) messages.push(after.timeTbd ? 'Start time is now unconfirmed.' : `Start time confirmed: ${date(after.start)}.`);
  else if (change.fields.includes('start')) messages.push(after.timeTbd ? 'Provisional date changed; time remains unconfirmed.' : `Moved from ${date(before.start)} to ${date(after.start)}.`);
  if (change.fields.includes('venue')) messages.push(`Venue: ${before.venue || 'unconfirmed'} → ${after.venue || 'unconfirmed'}.`);
  if (change.fields.includes('opponent')) messages.push(`Opponent: ${before.opponent} → ${after.opponent}.`);
  return messages.join(' ');
}
export function filterGames(games, { period = 'week', postseasonOnly = false, sport = 'all', timeZone = 'America/New_York' }, now = Date.now()) {
  const today = dateKey(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`);
  const dayOffset = (day.getUTCDay() + 6) % 7;
  const plus = n => new Date(day.getTime() + n * 86400000).toISOString().slice(0, 10);
  const from = period === 'today' ? today : period === 'weekend' ? plus(dayOffset === 6 ? -1 : 5 - dayOffset) : plus(-dayOffset);
  const to = period === 'today' ? today : period === 'weekend' ? plus(6 - dayOffset) : plus(6 - dayOffset);
  return games.filter(game => (period === 'season' || (gameDate(game, timeZone) >= from && gameDate(game, timeZone) <= to)) &&
    (sport === 'all' || game.sport === sport) && (!postseasonOnly || gamePhase(game) === 'postseason'));
}
