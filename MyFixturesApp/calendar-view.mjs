export const gameMinutes = sport => ['mlb', 'nfl'].includes(sport) ? 180 : ['nba', 'nhl'].includes(sport) ? 150 : 120;
export function dateKey(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function gameDate(game, zone) { return game.timeTbd && game.scheduledDate ? game.scheduledDate : dateKey(game.utcDate, zone); }
export function gamePhase(game) {
  return game.postseason || /playoff|postseason|play-in|playin|super bowl|wild card|conference championship|divisional/i.test(`${game.seasonType || ''} ${game.competition}`) ? 'postseason' : 'regular';
}
export function conflictKeys(games) {
  const active = games.filter(g => !g.timeTbd && !/cancel|postpon|suspend|^ppd$/i.test(g.status || '')).toSorted((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  const conflicts = new Set();
  for (let i = 0; i < active.length; i++) {
    const end = Date.parse(active[i].utcDate) + gameMinutes(active[i].sport) * 60000;
    for (let j = i + 1; j < active.length && Date.parse(active[j].utcDate) < end; j++) {
      if (active[i].key !== active[j].key) { conflicts.add(active[i].key); conflicts.add(active[j].key); }
    }
  }
  return conflicts;
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
