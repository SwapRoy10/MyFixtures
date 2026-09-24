// Shared, dependency-free rules for the browser and calendar service.
export function localDate(value, timeZone = 'America/New_York') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function gamePhase(game) {
  const value = `${game.seasonType || ''} ${game.competition || ''}`;
  if (game.postseason || /postseason|playoff|play-in|playin|super bowl|wild card|conference championship|divisional|world series|alcs|nlcs|alds|nlds/i.test(value)) return 'postseason';
  return /preseason|pre-season|spring training/i.test(value) ? 'preseason' : 'regular';
}
export function competitionName(game) {
  if (game.sport === 'nfl') return `NFL ${gamePhase(game) === 'postseason' ? 'Postseason' : gamePhase(game) === 'preseason' ? 'Preseason' : 'Regular Season'}`;
  if (game.sport === 'nba' && /nba cup/i.test(game.competition || '')) return 'NBA Cup';
  return game.competition || game.sport?.toUpperCase() || 'Other';
}
export const competitionKey = game => `${game.sport}:${competitionName(game).toLowerCase()}`;
export function confirmedOpponent(game) {
  return game.sport === 'f1' || Boolean(game.opponent && !/\b(?:tbd|tbc|tba)\b|^unknown$|to be (?:determined|confirmed|announced)|\b(?:winner|loser)\s+(?:of\s+)?(?:game|series|match)\b/i.test(game.opponent.trim()));
}
export function matchesPreferences(game, config) {
  const side = config.venueFilter || 'all';
  if (side !== 'all' && game.sport !== 'f1') {
    const sides = game.selectedSides || [game.home ? 'home' : 'away'];
    if (game.neutralSite || !sides.includes(side)) return false;
  }
  if (config.competitionFilters?.length && !config.competitionFilters.includes(competitionKey(game))) return false;
  const date = game.timeTbd && game.scheduledDate ? game.scheduledDate : localDate(game.utcDate, config.timeZone);
  return (!config.dateFrom || date >= config.dateFrom) && (!config.dateTo || date <= config.dateTo);
}
