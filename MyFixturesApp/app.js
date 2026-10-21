const fixtures = [];
let activeFixtureFilter = 'upcoming';
let nextUpFixture = null;
let followedSlate = null;
let followedSlateState = 'selected';
let followedSlateLoadId = 0;
const appRelease = '20261009-f1-sessions';
const scheduleSnapshots = new Map();
const f1Selection = { id: 'f1', sport: 'f1', name: 'Formula 1', abbreviation: 'F1', crest: 'https://city-png.b-cdn.net/thumbnail/thumbnail_public/uploads/preview/hd-f1-the-official-formula-1-transparent-png-701751712229525ajvwddtfme.png?v=2025092211' };
const nflSelection = { id: 18, sport: 'nfl', name: 'Philadelphia Eagles', abbreviation: 'PHI', crest: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' };
const mlbSelection = { id: 19, sport: 'mlb', name: 'New York Yankees', abbreviation: 'NYY', crest: 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png' };
const nbaSelection = { id: 23, sport: 'nba', name: 'Philadelphia 76ers', abbreviation: 'PHI', crest: 'https://a.espncdn.com/i/teamlogos/nba/500/phi.png' };
const nhlSelection = { id: 4, sport: 'nhl', name: 'Philadelphia Flyers', abbreviation: 'PHI', crest: 'https://assets.nhle.com/logos/nhl/svg/PHI_light.svg' };
const soccerSelection = { id: 57, sport: 'soccer', name: 'Arsenal', crest: 'https://crests.football-data.org/57.png' };
function defaultTeamForSport(sport) { return sport === 'f1' ? f1Selection : sport === 'nfl' ? nflSelection : sport === 'mlb' ? mlbSelection : sport === 'nba' ? nbaSelection : sport === 'nhl' ? nhlSelection : soccerSelection; }
let fixtureLoadId = 0;
let currentSport = localStorage.getItem('fixture-sport') || 'soccer';
let currentTeam = JSON.parse(localStorage.getItem('fixture-current-team') || 'null') || defaultTeamForSport(currentSport);
if ((currentTeam.sport || 'soccer') !== currentSport) {
  currentTeam = defaultTeamForSport(currentSport);
}
if (currentSport === 'f1') currentTeam = f1Selection;
const list = document.querySelector('#fixture-list');
const sourceNote = document.querySelector('#source-note');
const timezoneLabelElement = document.querySelector('#timezone-label');
const clubDialog = document.querySelector('#club-dialog');
const clubResults = document.querySelector('#club-results');
const savedClubs = document.querySelector('#saved-clubs');
const clubSearchInput = document.querySelector('#club-search-input');
const googleAllButton = document.querySelector('#google-all');
const sportSelect = document.querySelector('#sport-select');
const sportMenuButton = document.querySelector('#sport-menu-button');
const sportMenu = document.querySelector('#sport-menu');
const teamMarkWrapper = document.querySelector('#team-mark-wrapper');
const googleClientId = '182131305802-0i417v1pr1tarbne0gofgqcvr2oqolfb.apps.googleusercontent.com';
const calendarScope = 'https://www.googleapis.com/auth/calendar.events';
let selectedTimeZone = localStorage.getItem('fixture-time-zone') || 'America/New_York';
const timezoneSelect = document.querySelector('#timezone-select');
timezoneSelect.value = selectedTimeZone;
sportSelect.value = currentSport;
function timezoneLabel() { return timezoneSelect.options[timezoneSelect.selectedIndex].text; }
function sportLabel() { return currentSport === 'f1' ? 'Formula 1' : currentSport === 'nfl' ? 'NFL' : currentSport === 'mlb' ? 'MLB' : currentSport === 'nba' ? 'NBA' : currentSport === 'nhl' ? 'NHL' : 'Soccer'; }
function currentSeason() {
  const now = new Date();
  const startYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { startYear, endYear: startYear + 1, label: `${String(startYear).slice(-2)}/${String(startYear + 1).slice(-2)}` };
}
function fixtureDateRange() {
  const season = currentSeason();
  if (currentSport === 'f1') return `dateFrom=${new Date().getUTCFullYear()}-01-01&dateTo=${new Date().getUTCFullYear()}-12-31`;
  if (currentSport === 'mlb') {
    const today = selectedZoneDateKey();
    return `dateFrom=${today}&dateTo=${today.slice(0, 4)}-12-31`;
  }
  return `dateFrom=${season.startYear}-07-01&dateTo=${season.endYear}-06-30`;
}
function nflLogoUrl(abbreviation) { return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`; }
function mlbLogoUrl(abbreviation) { return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbreviation.toLowerCase()}.png`; }
function teamInitials(team) { return (team.abbreviation || team.name || 'TM').split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase(); }
function teamMark(team, mini = false) {
  const teamSport = team.sport || currentSport;
  const crest = team.crest || (teamSport === 'nfl' && team.abbreviation ? nflLogoUrl(team.abbreviation) : teamSport === 'mlb' && team.abbreviation ? mlbLogoUrl(team.abbreviation) : null);
  if (crest && /^https:\/\//i.test(crest)) return `<img class="${mini ? 'team-mini-crest' : 'club-mark'}" src="${escapeHtml(crest)}" alt="${escapeHtml(team.name)} logo">`;
  return `<span class="${mini ? 'team-mini-initials' : 'team-initials'}" aria-hidden="true">${escapeHtml(teamInitials(team))}</span>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function fixtureTitle(fixture) { return fixture.title || (currentSport === 'f1' ? fixture.opponent : currentTeam.name + ' v ' + fixture.opponent + ' - ' + fixture.competition); }
function f1SessionLabel(fixture) { return { race: 'Race', qualifying: 'Qualifying', sprint: 'Sprint', 'sprint-qualifying': 'Sprint Qualifying' }[fixture.sessionType] || 'Race'; }
function fixtureDuration(fixture) { return currentSport === 'f1' ? { qualifying: 60, sprint: 45, 'sprint-qualifying': 45 }[fixture.sessionType] || 120 : currentSport === 'mlb' || currentSport === 'nfl' ? 180 : ['nba', 'nhl'].includes(currentSport) ? 150 : 120; }
function fixtureDescription(fixture) { return currentSport === 'f1' ? `Formula 1 ${f1SessionLabel(fixture).toLowerCase()}. Calendar duration is estimated at ${fixtureDuration(fixture)} minutes.` : fixture.competition + ' - ' + currentTeam.name + ' ' + (fixture.home ? 'home' : 'away') + (['mlb', 'nba', 'nhl'].includes(currentSport) ? ' game' : ' fixture') + (['nba', 'nhl'].includes(currentSport) ? '. Calendar duration is estimated at two and a half hours.' : ''); }
function setTeamHeader() {
  const isF1 = currentSport === 'f1';
  const isMlb = currentSport === 'mlb';
  const isNba = currentSport === 'nba';
  const isNhl = currentSport === 'nhl';
  const season = currentSeason();
  if (document.body) document.body.dataset.sport = currentSport;
  document.querySelector('.hero-copy .eyebrow').textContent = isF1 ? 'YOUR RACEDAY, ORGANIZED' : isMlb ? 'YOUR BALLPARK, ORGANIZED' : isNba || isNhl ? 'YOUR GAMEDAY, ORGANIZED' : 'Your matchday, organised';
  document.querySelector('.hero-copy h1').innerHTML = isF1 ? 'Never miss<br><em>lights out.</em>' : isMlb ? 'Series by series.<br><em>Every pitch synced.</em>' : isNhl ? 'Never miss<br><em>the puck drop.</em>' : isNba ? 'Never miss<br><em>the tipoff.</em>' : 'Never miss<br><em>the kickoff.</em>';
  document.querySelector('.hero-copy .lede').textContent = isF1 ? 'Every Grand Prix weekend in one place: qualifying, sprint sessions and race day. Add a session or the whole season.' : isMlb ? 'Upcoming games grouped into series. Add one game, a full series, or the rest of the season.' : isNhl ? 'Your team, all season long. Add one game or every upcoming puck drop to your calendar.' : isNba ? 'Your team, all season long. Add one game or every upcoming tipoff to your calendar.' : 'A focused calendar for the fixtures of all your favorite teams. Add one match or the whole season in seconds.';
  document.querySelector('#club-select').disabled = isF1;
  document.querySelector('#add-fixture').hidden = isF1;
  document.querySelector('.section-label').textContent = isF1 ? 'Selected championship' : 'Selected team';
  document.querySelector('.topbar-meta > span:nth-child(2)').textContent = isF1 || isMlb ? 'Season ' + new Date().getUTCFullYear() : `Season ${season.label}`;
  document.querySelector('#pulse-season').textContent = isF1 || isMlb ? String(new Date().getUTCFullYear()) : `${season.startYear}/${String(season.endYear).slice(-2)}`;
  document.querySelector('#mobile-team-season').textContent = `${sportLabel()} · ${isF1 || isMlb ? new Date().getUTCFullYear() : season.label}`;
  document.querySelector('#sport-menu-label').textContent = sportLabel();
  document.querySelectorAll('[data-sport-value]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.sportValue === currentSport)));
  document.querySelector('#mobile-add').hidden = isF1;
  document.querySelector('.section-heading .eyebrow').textContent = isF1 ? new Date().getUTCFullYear() + ' Formula 1 season' : isMlb ? `${new Date().getUTCFullYear()} MLB season - today forward` : isNba || isNhl ? `${season.startYear}-${String(season.endYear).slice(-2)} ${sportLabel()} season` : `${season.label} season - July through June`;
  document.querySelector('.section-heading h2').textContent = isF1 ? 'Every Grand Prix.' : isMlb ? 'Every series. Every game.' : isNba || isNhl ? 'Every team. Every game.' : 'Every team. Every match.';
  document.querySelector('#fixture-time-label').textContent = isNhl ? 'Puck drop' : isNba ? 'Tipoff' : 'Kickoff';
  document.querySelector('#club-name').textContent = currentTeam.name;
  teamMarkWrapper.innerHTML = teamMark(currentTeam);
}
function convertWallTimeToUtc(dateValue, timeValue, timeZone) {
  const target = Date.parse(`${dateValue}T${timeValue}:00Z`);
  let guess = new Date(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(guess);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const displayed = Date.parse(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00Z`);
    guess = new Date(guess.getTime() + (target - displayed));
  }
  return guess;
}
function fixtureDisplay(fixture) {
  if (fixture.timeTbd && fixture.scheduledDate) return { date: new Date(`${fixture.scheduledDate}T12:00:00Z`), time: 'TBD' };
  const sourceDate = fixture.utcDate ? new Date(fixture.utcDate) : convertWallTimeToUtc(fixture.date, fixture.time, 'America/New_York');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: selectedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(sourceDate);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`), time: `${values.hour}:${values.minute}` };
}
function selectedZoneDateKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: selectedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function fixtureDateKey(fixture) { return fixtureDisplay(fixture).date.toISOString().slice(0, 10); }
function fixtureSortTime(fixture) {
  if (fixture.utcDate) return new Date(fixture.utcDate).getTime();
  return convertWallTimeToUtc(fixture.date, fixture.time || '23:59', 'America/New_York').getTime();
}
function isPastFixture(fixture) {
  if (fixture.timeTbd) return fixtureDateKey(fixture) < selectedZoneDateKey();
  return fixtureSortTime(fixture) < Date.now();
}
function exportableFixture(fixture) { return !fixture.timeTbd && !/cancel|abandon|postpon|suspend|^ppd$|^cncl$/i.test(fixture.status || '') && !/\b(tbd|tbc|tba)\b|winner of|loser of/i.test(fixture.opponent || '') && !isPastFixture(fixture); }
function calendarReadyFixtures(selected = fixtures) { return selected.filter(exportableFixture); }
let renderedMlbSeries = [];
function groupMlbSeries(orderedFixtures) {
  const series = [];
  orderedFixtures.forEach((fixture, index) => {
    const previousSeries = series.at(-1);
    const previousFixture = previousSeries?.games.at(-1)?.fixture;
    const gap = previousFixture ? fixtureSortTime(fixture) - fixtureSortTime(previousFixture) : Infinity;
    const sameOpponent = previousFixture && previousFixture.opponent.toLowerCase() === fixture.opponent.toLowerCase();
    const sameSeasonType = previousFixture && (previousFixture.seasonType || previousFixture.competition) === (fixture.seasonType || fixture.competition);
    if (sameOpponent && sameSeasonType && gap >= 0 && gap <= 4 * 24 * 60 * 60 * 1000) {
      previousSeries.games.push({ fixture, index });
    } else {
      series.push({ opponent: fixture.opponent, games: [{ fixture, index }] });
    }
  });
  return series;
}
function seriesDateLabel(series) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: selectedTimeZone, month: 'short', day: 'numeric' });
  const first = fixtureDisplay(series.games[0].fixture).date;
  const last = fixtureDisplay(series.games.at(-1).fixture).date;
  return first.getTime() === last.getTime() ? formatter.format(first) : `${formatter.format(first)}-${formatter.format(last)}`;
}
function fixtureActionButton(fixture, index) {
  const past = isPastFixture(fixture);
  return !exportableFixture(fixture)
    ? `<button class="fixture-add fixture-add-disabled" type="button" disabled>${past ? 'Played' : 'Time TBD'}</button>`
    : `<button class="fixture-add" data-index="${index}">+ Google Calendar</button>`;
}
function fixtureMonth(fixture) { return fixtureDisplay(fixture).date.toISOString().slice(0, 7); }
function monthHeading(month, count, noun) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00Z`));
  return `<h3 class="month-divider"><span>${escapeHtml(label)}</span><small>${count} ${count === 1 ? noun : `${noun}s`}</small></h3>${noun === 'series' ? '' : '<div class="ledger-columns" aria-hidden="true"><span>Date / time</span><span>Matchup &amp; competition</span><span>Venue</span><span>Calendar sync</span></div>'}`;
}
function matchesFixtureFilter(fixture, filter = activeFixtureFilter) {
  const today = selectedZoneDateKey();
  const date = fixtureDateKey(fixture);
  const weekEnd = new Date(`${today}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  if (filter === 'week') return date >= today && date <= weekEnd.toISOString().slice(0, 10) && !isPastFixture(fixture);
  if (filter === 'upcoming') return !isPastFixture(fixture);
  if (filter === 'played') return isPastFixture(fixture);
  if (filter === 'home') return currentSport !== 'f1' && fixture.home && !fixture.neutralSite;
  return true;
}
function renderSevenDaySlate() {
  const grid = document.querySelector('#slate-grid');
  const source = document.querySelector('#slate-source');
  const combined = Boolean(followedSlate);
  source.textContent = followedSlateState === 'stale' ? 'My Week update delayed · showing the last saved slate' : combined && followedSlateState === 'preparing' ? 'My Week is preparing · some followed schedules may still be loading' : combined ? `All ${followedSlate.teamCount} followed ${followedSlate.teamCount === 1 ? 'team' : 'teams'} in My Week` : followedSlateState === 'loading' ? `Loading My Week · showing ${currentTeam.name} for now` : `Showing ${currentTeam.name} · create My Week to combine teams`;
  const today = selectedZoneDateKey();
  grid.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const games = combined
      ? followedSlate.games.filter(game => (game.timeTbd && game.scheduledDate ? game.scheduledDate : selectedZoneDateKey(game.utcDate)) === key)
      : fixtures.filter(fixture => fixtureDateKey(fixture) === key);
    games.sort((first, second) => Number(Boolean(first.timeTbd)) - Number(Boolean(second.timeTbd)) || Date.parse(first.utcDate || `${first.date}T12:00:00Z`) - Date.parse(second.utcDate || `${second.date}T12:00:00Z`));
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(day);
    const cards = games.map(game => {
      const title = combined ? game.title : currentSport === 'f1' ? fixtureTitle(game) : `${game.home ? 'vs' : '@'} ${game.opponent}`;
      const cancelled = /cancel|abandon|^cncl$/i.test(game.status || '');
      const pending = game.timeTbd || /postpon|suspend|^ppd$/i.test(game.status || '');
      const time = cancelled ? 'Canceled' : pending ? 'TBD' : combined ? new Intl.DateTimeFormat('en-US', { timeZone: selectedTimeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(game.utcDate)) : fixtureDisplay(game).time;
      return `<div class="slate-game"><small>${escapeHtml(combined ? game.sport.toUpperCase() : sportLabel().toUpperCase())}</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(time)}</span></div>`;
    }).join('');
    return `<div class="slate-day${index === 0 ? ' today' : ''}"><div class="slate-date"><strong>${label} ${day.getUTCDate()}</strong><span>${games.length ? `${games.length} ${games.length === 1 ? 'game' : 'games'}` : 'Rest'}</span></div>${cards || '<span class="slate-rest">No games</span>'}</div>`;
  }).join('');
  replayEntrance(grid);
}
function replayEntrance(element, className = 'content-enter') {
  if (!element?.classList || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
async function loadFollowedSlate() {
  const loadId = ++followedSlateLoadId;
  let id;
  try { id = JSON.parse(localStorage.getItem('living-calendar-owner') || 'null')?.id; } catch { return; }
  if (!/^[a-f0-9]{32}$/.test(id || '')) { const wasCombined = Boolean(followedSlate); followedSlate = null; followedSlateState = 'selected'; if (wasCombined) renderSevenDaySlate(); return; }
  if (followedSlate?.id !== id) followedSlate = null;
  followedSlateState = 'loading';
  renderSevenDaySlate();
  try {
    const response = await fetch(`/api/calendars/${id}`, { signal: globalThis.AbortSignal?.timeout(25000) });
    if (!response.ok) throw new Error(`My Week returned ${response.status}`);
    const data = await response.json();
    if (loadId !== followedSlateLoadId) return;
    if (data.revoked || !Array.isArray(data.games)) throw new Error('My Week is unavailable');
    followedSlate = { id, games: data.games, teamCount: data.config?.teams?.length || 0 };
    followedSlateState = data.ready ? 'current' : 'preparing';
    try { localStorage.setItem(`myweek-slate:${id}`, JSON.stringify({ ...followedSlate, savedAt: Date.now() })); } catch { /* The live slate still works without browser storage. */ }
  } catch {
    if (loadId !== followedSlateLoadId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`myweek-slate:${id}`) || 'null');
      if (Array.isArray(saved?.games)) { followedSlate = saved; followedSlateState = 'stale'; }
      else followedSlateState = 'selected';
    } catch { followedSlateState = 'selected'; }
  }
  renderSevenDaySlate();
}
function mlbGamePanel(entry, seriesIndex, gameIndex) {
  const { fixture, index } = entry;
  const display = fixtureDisplay(fixture);
  const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, day: '2-digit', month: 'short' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, weekday: 'short' });
  const kickoff = fixture.timeTbd ? 'TBD' : display.time;
  return `<div class="fixture series-game" id="series-${seriesIndex}-game-${gameIndex}" role="tabpanel" aria-labelledby="series-${seriesIndex}-tab-${gameIndex}"${gameIndex ? ' hidden' : ''}><div class="fixture-date"><strong>${dateFormat.format(display.date)}</strong><small>${dayFormat.format(display.date)}</small></div><div><div class="opponent">${escapeHtml(currentTeam.name)} v ${escapeHtml(fixture.opponent)}</div><div class="home-away">${fixture.home ? 'Home' : 'Away'} &middot; ${escapeHtml(fixture.competition)}</div></div><div class="fixture-meta"><b>${kickoff}</b>${fixture.venue && fixture.venue !== 'TBC' ? `<br>${escapeHtml(fixture.venue)}` : ''}</div>${fixtureActionButton(fixture, index)}</div>`;
}
function renderMlbFixtures(orderedFixtures) {
  renderedMlbSeries = groupMlbSeries(orderedFixtures);
  if (!renderedMlbSeries.length) {
    list.innerHTML = '<div class="empty-schedule"><strong>No games currently scheduled.</strong><span>Newly determined postseason games will appear automatically.</span></div>';
    return;
  }
  const monthCounts = new Map();
  for (const series of renderedMlbSeries) { const month = fixtureMonth(series.games[0].fixture); monthCounts.set(month, (monthCounts.get(month) || 0) + 1); }
  let shownMonth = '';
  list.innerHTML = renderedMlbSeries.map((series, seriesIndex) => {
    const month = fixtureMonth(series.games[0].fixture);
    const heading = month !== shownMonth ? monthHeading(month, monthCounts.get(month), 'series') : '';
    shownMonth = month;
    const fixturesInSeries = series.games.map(entry => entry.fixture);
    const readyGames = calendarReadyFixtures(fixturesInSeries);
    const allHome = fixturesInSeries.every(fixture => fixture.home);
    const allAway = fixturesInSeries.every(fixture => !fixture.home);
    const site = allHome ? 'Home series' : allAway ? 'Away series' : 'Split sites';
    const phase = fixturesInSeries.some(fixture => fixture.postseason) ? 'Postseason' : 'Regular season';
    const countLabel = fixturesInSeries.length === 1 ? 'Single game' : `${fixturesInSeries.length}-game series`;
    const tabs = series.games.map((entry, gameIndex) => `<button class="series-tab" id="series-${seriesIndex}-tab-${gameIndex}" type="button" role="tab" aria-selected="${gameIndex === 0}" aria-controls="series-${seriesIndex}-game-${gameIndex}" tabindex="${gameIndex === 0 ? '0' : '-1'}">Game ${gameIndex + 1}</button>`).join('');
    const panels = series.games.map((entry, gameIndex) => mlbGamePanel(entry, seriesIndex, gameIndex)).join('');
    return `${heading}<article class="series-card"><div class="series-heading"><div><p class="series-kicker">${escapeHtml(phase)} &middot; ${escapeHtml(seriesDateLabel(series))}</p><h3>${escapeHtml(countLabel)} vs ${escapeHtml(series.opponent)}</h3><p class="series-summary">${site}</p></div><button class="series-add" type="button" data-series-add="${seriesIndex}"${readyGames.length ? '' : ' disabled'}>+ Add series</button></div><div class="series-tabs" role="tablist" aria-label="Games against ${escapeHtml(series.opponent)}">${tabs}</div>${panels}</article>`;
  }).join('');
  list.querySelectorAll('.series-tab').forEach(tab => {
    tab.addEventListener('click', () => activateSeriesTab(tab));
    tab.addEventListener('keydown', event => {
      const tabs = [...tab.parentElement.querySelectorAll('.series-tab')];
      const index = tabs.indexOf(tab);
      const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
      if (target) { event.preventDefault(); activateSeriesTab(target); target.focus(); }
    });
  });
  list.querySelectorAll('[data-series-add]').forEach(button => button.addEventListener('click', () => addSeriesToGoogleCalendar(Number(button.dataset.seriesAdd), button)));
}
function activateSeriesTab(tab) {
  const card = tab.closest('.series-card');
  card.querySelectorAll('.series-tab').forEach(button => { button.setAttribute('aria-selected', String(button === tab)); button.tabIndex = button === tab ? 0 : -1; });
  card.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
}
function fixtureCard(fixture, index) {
  const display = fixtureDisplay(fixture);
  const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, day: '2-digit', month: 'short' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, weekday: 'short' });
  const past = isPastFixture(fixture);
  const kickoff = fixture.timeTbd ? 'TBD' : display.time;
  const homeTeam = fixture.home ? currentTeam.name : fixture.opponent;
  const awayTeam = fixture.home ? fixture.opponent : currentTeam.name;
  return `<article class="fixture${past ? ' fixture-past' : ''}"><div class="fixture-date"><strong>${dateFormat.format(display.date)}</strong><small>${dayFormat.format(display.date)}</small><span class="fixture-kickoff">${kickoff}</span></div><div class="fixture-matchup">${index === 0 && !past ? '<span class="fixture-status">Next up</span>' : ''}<div class="opponent">${currentSport === 'f1' ? escapeHtml(fixtureTitle(fixture)) : `<span class="${fixture.home ? 'selected-team' : ''}">${escapeHtml(homeTeam)}</span><span class="matchup-vs">vs</span><span class="${fixture.home ? '' : 'selected-team'}">${escapeHtml(awayTeam)}</span>`}</div><div class="home-away">${currentSport === 'f1' ? f1SessionLabel(fixture) : fixture.neutralSite ? 'Neutral site' : fixture.home ? 'Home' : 'Away'} &middot; ${escapeHtml(fixture.competition)}</div></div><div class="fixture-meta">${fixture.venue && fixture.venue !== 'TBC' ? `<span class="venue-label">Venue</span><span>${escapeHtml(fixture.venue)}</span>` : '<span class="venue-label">Venue to be announced</span>'}</div>${fixtureActionButton(fixture, index)}</article>`;
}
function render() {
  renderSevenDaySlate();
  const orderedFixtures = fixtures.filter(fixture => matchesFixtureFilter(fixture)).sort((first, second) => (first.utcDate || first.date).localeCompare(second.utcDate || second.date));
  for (const filter of ['all', 'week', 'upcoming', 'played', 'home']) {
    document.querySelector(`#filter-${filter}-count`).textContent = String(fixtures.filter(fixture => matchesFixtureFilter(fixture, filter)).length);
  }
  document.querySelectorAll('[data-fixture-filter]').forEach(button => { const active = button.dataset.fixtureFilter === activeFixtureFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.hidden = currentSport === 'f1' && button.dataset.fixtureFilter === 'home'; });
  document.querySelector('#mobile-sync-label').textContent = `Add ${calendarReadyFixtures().length} ${currentSport === 'f1' ? 'sessions' : 'games'} to calendar`;
  if (currentSport === 'mlb') {
    renderMlbFixtures(orderedFixtures);
  } else {
    renderedMlbSeries = [];
    const monthCounts = new Map();
    for (const fixture of orderedFixtures) { const month = fixtureMonth(fixture); monthCounts.set(month, (monthCounts.get(month) || 0) + 1); }
    let shownMonth = '';
    const groupedCards = (items, indexOf) => { let month = ''; return items.map(fixture => { const current = fixtureMonth(fixture); const heading = current !== month ? monthHeading(current, items.filter(item => fixtureMonth(item) === current).length, currentSport === 'f1' ? 'session' : 'fixture') : ''; month = current; return heading + fixtureCard(fixture, indexOf(fixture)); }).join(''); };
    const earlier = activeFixtureFilter === 'upcoming' ? fixtures.filter(isPastFixture).sort((first, second) => fixtureSortTime(first) - fixtureSortTime(second)) : [];
    const earlierFold = earlier.length ? `<details class="earlier-fixtures"${orderedFixtures.length ? '' : ' open'}><summary><span>Earlier this season</span><small>${earlier.length} ${currentSport === 'f1' ? 'completed' : 'played'}</small></summary><div class="earlier-list">${groupedCards(earlier, () => -1)}</div></details>` : '';
    list.innerHTML = earlierFold + orderedFixtures.map((fixture, index) => {
    const month = fixtureMonth(fixture);
    const heading = month !== shownMonth ? monthHeading(month, monthCounts.get(month), currentSport === 'f1' ? 'session' : 'fixture') : '';
    shownMonth = month;
    return heading + fixtureCard(fixture, index);
    }).join('');
  }
  document.querySelector('#fixture-count').textContent = `${orderedFixtures.length} ${currentSport === 'f1' ? orderedFixtures.length === 1 ? 'session' : 'sessions' : orderedFixtures.length === 1 ? 'game' : 'games'} in this view`;
  const next = calendarReadyFixtures().sort((first, second) => fixtureSortTime(first) - fixtureSortTime(second))[0];
  const untilNext = next ? Math.max(0, fixtureSortTime(next) - Date.now()) : 0;
  document.querySelector('#pulse-count').textContent = next ? `${Math.floor(untilNext / 86400000)}d ${String(Math.floor((untilNext % 86400000) / 3600000)).padStart(2, '0')}h` : '—';
  document.querySelector('#pulse-caption').textContent = currentSport === 'f1' ? 'To next F1 session' : currentSport === 'mlb' ? 'To next first pitch' : currentSport === 'nhl' ? 'To next puck drop' : currentSport === 'nba' ? 'To next tipoff' : 'To next kickoff';
  document.querySelector('#pulse-fixtures').textContent = `${fixtures.length} ${fixtures.length === 1 ? 'fixture' : 'fixtures'} in this season view`;
  document.querySelector('#pulse-next').textContent = next
    ? `Next confirmed: ${currentSport === 'f1' ? fixtureTitle(next) : next.opponent} · ${new Intl.DateTimeFormat('en-US', { timeZone: selectedTimeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(fixtureSortTime(next)))}`
    : 'No confirmed upcoming start is currently published.';
  nextUpFixture = next || null;
  const nextWhen = next ? new Intl.DateTimeFormat('en-US', { timeZone: selectedTimeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(fixtureSortTime(next))) : '';
  document.querySelector('#next-up-opponent').textContent = !next ? 'No confirmed game yet' : currentSport === 'f1' ? fixtureTitle(next) : `${next.home || next.neutralSite ? 'vs' : '@'} ${next.opponent}`;
  document.querySelector('#next-up-competition').textContent = !next ? 'Check back when the schedule is published' : [currentSport === 'f1' ? f1SessionLabel(next) : next.neutralSite ? 'Neutral site' : next.home ? 'Home' : 'Away', next.competition].filter(Boolean).join(' · ');
  document.querySelector('#next-up-when').textContent = next ? [nextWhen, next.venue && next.venue !== 'TBC' ? next.venue : ''].filter(Boolean).join(' · ') : '';
  document.querySelector('#next-up-add').disabled = !next;
  document.querySelectorAll('.fixture-add[data-index]').forEach(button => button.addEventListener('click', () => openGoogleCalendar(orderedFixtures[button.dataset.index])));
  replayEntrance(list);
}
function formatFixtureForSelectedZone(timestamp) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: selectedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
async function loadLiveFixtures() {
  const loadId = ++fixtureLoadId;
  const snapshotKey = `${currentSport}:${currentTeam.id}:${fixtureDateRange()}`;
  const healthElement = document.querySelector('#schedule-health');
  const storedSnapshot = () => {
    try { return scheduleSnapshots.get(snapshotKey) || JSON.parse(localStorage.getItem(`schedule-snapshot:${snapshotKey}`) || 'null'); } catch { return null; }
  };
  const reportHealth = health => {
    const coverage = health?.coverage === 'published' ? 'Published feed loaded; future matchups may still be announced.' : health?.coverage === 'partial' ? 'Some sources are missing; schedule may be incomplete.' : 'Completeness is not independently verified.';
    const stamp = health?.updated ? new Date(health.updated).toLocaleString(undefined, { timeZone: selectedTimeZone }) : 'not available';
    healthElement.textContent = `${health?.state === 'stale' ? 'Update delayed — showing the last successful schedule.' : health?.state === 'unpublished' ? 'No games published for this range yet.' : 'Schedule loaded.'} Last successful check: ${stamp}. ${coverage}`;
  };
  healthElement.textContent = 'Checking the published schedule…';
  try {
    const dateRange = fixtureDateRange();
    const competitions = Array.isArray(currentTeam.competitions) && currentTeam.competitions.length ? `&competitions=${encodeURIComponent(currentTeam.competitions.join(','))}` : '';
    const identity = `&teamName=${encodeURIComponent(currentTeam.fullName || currentTeam.name || '')}&teamAbbreviation=${encodeURIComponent(currentTeam.abbreviation || '')}`;
    const response = await fetch(`/api/fixtures?sport=${encodeURIComponent(currentSport)}&team=${currentTeam.id}&${dateRange}${competitions}${identity}&release=${appRelease}`, { signal: globalThis.AbortSignal?.timeout(30000) });
    const payload = await response.json();
    if (loadId !== fixtureLoadId) return;
    if (!response.ok) throw new Error(payload.error || `Fixture API returned ${response.status}`);
    const liveFixtures = payload.fixtures;
    if (!Array.isArray(liveFixtures) || Object.keys(payload.errors || {}).length) throw new Error('Schedule provider returned an incomplete response.');
    const previous = storedSnapshot();
    if (payload.health?.coverage === 'partial' && previous?.health?.coverage !== 'partial' && previous?.health?.updated > Date.now() - 7 * 86400000 && previous?.fixtures?.length) throw new Error('Some schedule sources are currently unavailable.');
    if (liveFixtures.length === 0 && previous?.fixtures.some(f => Date.parse(f.utcDate) > Date.now())) throw new Error('Unexpected empty schedule.');
    fixtures.splice(0, fixtures.length, ...liveFixtures.map(item => {
      if (item.utcDate && item.opponent) {
        const kickoff = formatFixtureForSelectedZone(item.utcDate);
        return { ...item, date: kickoff.date, time: kickoff.time };
      }
      const kickoff = formatFixtureForSelectedZone(item.utcDate);
      return { ...kickoff, utcDate: item.utcDate, opponent: item.homeTeam.id === currentTeam.id ? item.awayTeam.name : item.homeTeam.name, venue: item.venue || '', competition: item.competition.name, home: item.homeTeam.id === currentTeam.id };
    }));
    const health = payload.health || { updated: Date.now(), coverage: 'unverified', state: liveFixtures.length ? 'current' : 'unpublished' };
    const snapshot = { fixtures: [...fixtures], health };
    scheduleSnapshots.set(snapshotKey, snapshot);
    try { localStorage.setItem(`schedule-snapshot:${snapshotKey}`, JSON.stringify(snapshot)); } catch { /* Browser storage may be full or disabled. */ }
    reportHealth(health);
    setTeamHeader();
    const source = currentSport === 'nhl' ? '<a href="https://www.nhl.com/schedule" target="_blank" rel="noreferrer">NHL</a>' : currentSport === 'soccer' && payload.source === 'football-data+espn' ? '<a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a> and ESPN' : currentSport === 'soccer' && payload.source === 'espn' ? 'ESPN schedule data' : currentSport === 'nfl' && payload.provider === 'espn' ? 'ESPN schedule data' : currentSport === 'f1' && payload.provider === 'jolpica' ? '<a href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">Jolpica F1</a>' : ['nfl', 'f1', 'mlb', 'nba'].includes(currentSport) ? '<a href="https://www.balldontlie.io/" target="_blank" rel="noreferrer">BALLDONTLIE</a>' : '<a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>';
    sourceNote.innerHTML = `Live ${sportLabel()} schedule from ${source}. Times shown in your selected time zone.${currentSport === 'mlb' ? ' Showing games from today forward, including determined postseason matchups.' : ''}`;
    if (currentSport === 'f1') {
      sourceNote.innerHTML += ' Includes race, qualifying, sprint and sprint-qualifying sessions when published. Unconfirmed times are excluded from calendar exports.';
      if (!liveFixtures.length) sourceNote.textContent = 'No Formula 1 sessions are available for this season.';
    }
    if (currentSport === 'mlb' && !liveFixtures.length) sourceNote.textContent = 'No remaining MLB games are currently scheduled for this team.';
    if (currentSport === 'nhl') {
      sourceNote.innerHTML += ' Includes published preseason, regular-season and Stanley Cup playoff games. Playoff matchups appear when scheduled. Unconfirmed times are excluded from calendar exports.';
      if (!liveFixtures.length) sourceNote.textContent = 'No NHL games have been published for this team and season yet. Please check back later.';
    }
    if (currentSport === 'nba') {
      sourceNote.innerHTML += `${payload.venueProvider === 'espn' ? ' Venues from ESPN.' : ''} Includes announced preseason, regular-season, NBA Cup and postseason games. Additional Cup and playoff matchups appear when scheduled. Unconfirmed times are excluded from calendar exports.`;
      if (!liveFixtures.length) sourceNote.textContent = 'The NBA schedule for this team has not been published yet. Please check back later.';
    }
    render();
  } catch (error) {
    if (loadId !== fixtureLoadId) return;
    const saved = storedSnapshot();
    const usable = saved?.health?.updated > Date.now() - 7 * 86400000 && Array.isArray(saved?.fixtures);
    fixtures.splice(0, fixtures.length, ...(usable ? saved.fixtures : []));
    render();
    sourceNote.textContent = `${error.message} ${usable ? 'Previously fetched games are preserved; details may have changed.' : 'No verified saved schedule is available. No sample games are substituted.'}`;
    if (usable) reportHealth({ ...saved.health, state: 'stale' });
    else healthElement.textContent = 'Schedule unavailable. Please retry shortly; this does not mean the team has no games.';
  }
}
function escapeICS(value) { return String(value).replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n'); }
function calendarEnd(fixture) {
  return formatFixtureForSelectedZone(fixtureSortTime(fixture) + fixtureDuration(fixture) * 60 * 1000);
}
function googleCalendarUrl(fixture) {
  const display = fixtureDisplay(fixture);
  const start = `${display.date.toISOString().slice(0, 10).replaceAll('-', '')}T${display.time.replace(':', '')}00`;
  const end = `${calendarEnd(fixture).date.replaceAll('-', '')}T${calendarEnd(fixture).time.replace(':', '')}00`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: fixtureTitle(fixture), dates: `${start}/${end}`, ctz: selectedTimeZone, details: fixtureDescription(fixture), ...(fixture.venue && fixture.venue !== 'TBC' ? { location: fixture.venue } : {}) });
  return `https://calendar.google.com/calendar/render?${params}`;
}
function openGoogleCalendar(fixture) {
  if (!fixture || !exportableFixture(fixture)) return;
  window.open(googleCalendarUrl(fixture), '_blank', 'noopener');
}
function googleAuthMessage(error) {
  const message = error.message || '';
  if (message.includes('origin') || message.includes('Origin')) return 'Google rejected this site origin. Add https://my-fixtures-api.sorp.workers.dev as an authorized JavaScript origin.';
  if (message.includes('access_denied') || message.includes('organization')) return 'Google blocked this account. Set the OAuth app to External and add your account as a test user.';
  if (message.includes('popup')) return 'Google sign-in was blocked. Allow popups for this site and try again.';
  return `Google Calendar could not be connected: ${message}`;
}
function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - started > 10000) return reject(new Error('Google sign-in could not load.'));
      setTimeout(check, 100);
    };
    check();
  });
}
async function getGoogleAccessToken() {
  await waitForGoogleIdentity();
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({ client_id: googleClientId, scope: calendarScope, callback: response => response.error ? reject(new Error(response.error_description || response.error)) : resolve(response.access_token), error_callback: error => reject(new Error(error.type || 'Google sign-in was cancelled or blocked.')) });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}
async function addFixturesToGoogleCalendar(selectedFixtures, button, successLabel) {
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>…</span> Connecting to Google';
  try {
    const orderedFixtures = calendarReadyFixtures(selectedFixtures).sort((first, second) => fixtureSortTime(first) - fixtureSortTime(second));
    if (!orderedFixtures.length) throw new Error('No remaining fixtures have confirmed start times.');
    // Capture the selected team and timezone before sign-in or a sport switch.
    const events = orderedFixtures.map(googleCalendarEvent);
    const token = await getGoogleAccessToken();
    for (let index = 0; index < events.length; index += 1) {
      button.innerHTML = `<span>…</span> Adding ${index + 1} of ${orderedFixtures.length}`;
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(events[index]) });
      if (!response.ok) throw new Error(`Google Calendar rejected fixture ${index + 1}`);
    }
    button.innerHTML = `<span>✓</span> ${successLabel}`;
  } catch (error) {
    button.innerHTML = originalLabel;
    sourceNote.textContent = googleAuthMessage(error);
  } finally {
    button.disabled = false;
  }
}
async function addAllToGoogleCalendar() {
  return addFixturesToGoogleCalendar(fixtures, googleAllButton, 'Fixtures added to Google Calendar');
}
async function addSeriesToGoogleCalendar(seriesIndex, button) {
  const series = renderedMlbSeries[seriesIndex];
  if (!series) return;
  return addFixturesToGoogleCalendar(series.games.map(entry => entry.fixture), button, 'Series added to Google Calendar');
}
function googleCalendarEvent(fixture) {
  const display = fixtureDisplay(fixture);
  return { summary: fixtureTitle(fixture), description: fixtureDescription(fixture), ...(fixture.venue && fixture.venue !== 'TBC' ? { location: fixture.venue } : {}), start: { dateTime: `${display.date.toISOString().slice(0, 10)}T${display.time}:00`, timeZone: selectedTimeZone }, end: { dateTime: `${calendarEnd(fixture).date}T${calendarEnd(fixture).time}:00`, timeZone: selectedTimeZone } };
}
function readSavedClubs() { return JSON.parse(localStorage.getItem('fixture-saved-clubs') || '[]'); }
function writeSavedClubs(clubs) { localStorage.setItem('fixture-saved-clubs', JSON.stringify(clubs)); }
function renderSavedClubs() {
  const clubs = readSavedClubs().filter(team => (team.sport || 'soccer') === currentSport);
  savedClubs.innerHTML = clubs.length ? clubs.map(team => `<div class="saved-club" data-team="${escapeHtml(team.id)}"><button class="saved-club-main" data-open-team="${escapeHtml(team.id)}">${teamMark(team, true)}${escapeHtml(team.name)}</button><button class="saved-club-remove" data-remove-team="${escapeHtml(team.id)}" type="button" aria-label="Remove ${escapeHtml(team.name)}">×</button></div>`).join('') : `<span class="timezone">No saved ${sportLabel()} teams yet</span>`;
  savedClubs.querySelectorAll('[data-open-team]').forEach(button => button.addEventListener('click', () => selectTeam(clubs.find(team => String(team.id) === button.dataset.openTeam))));
  savedClubs.querySelectorAll('[data-remove-team]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); writeSavedClubs(readSavedClubs().filter(team => `${team.sport || 'soccer'}:${team.id}` !== `${currentSport}:${button.dataset.removeTeam}`)); renderSavedClubs(); }));
}
async function searchTeams(event) {
  event.preventDefault();
  const search = clubSearchInput.value.trim();
  if (!search) return;
  clubResults.innerHTML = '<span class="timezone">Searching...</span>';
  try {
    const response = await fetch(`/api/teams?sport=${encodeURIComponent(currentSport)}&search=${encodeURIComponent(search)}&_=${Date.now()}`);
    if (!response.ok) throw new Error((await response.json()).error || 'Team search unavailable');
    const teams = await response.json();
    clubResults.innerHTML = teams.length ? teams.map(team => `<button class="club-result" data-team="${escapeHtml(team.id)}"><span class="club-result-main">${teamMark(team, true)}${escapeHtml(team.name)}</span><span>＋ Save</span></button>`).join('') : '<span class="timezone">No teams found</span>';
    clubResults.querySelectorAll('.club-result').forEach(button => button.addEventListener('click', () => selectTeam(teams.find(team => String(team.id) === button.dataset.team))));
  } catch (error) { clubResults.innerHTML = `<span class="timezone">${escapeHtml(error.message)}</span>`; }
}
async function selectTeam(team) {
  if (!team) return;
  activeFixtureFilter = 'upcoming';
  const normalizedTeam = { ...team, sport: team.sport || currentSport };
  const clubs = readSavedClubs().filter(saved => `${saved.sport || 'soccer'}:${saved.id}` !== `${normalizedTeam.sport}:${normalizedTeam.id}`);
  writeSavedClubs([normalizedTeam, ...clubs].slice(0, 12));
  currentTeam = normalizedTeam;
  fixtures.splice(0, fixtures.length);
  render();
  localStorage.setItem('fixture-current-team', JSON.stringify(currentTeam));
  clubDialog.close();
  renderSavedClubs();
  sourceNote.textContent = `Loading ${team.name} fixtures...`;
  setTeamHeader();
  await loadLiveFixtures();
}
function calendarEvent(fixture) {
  const display = fixtureDisplay(fixture);
  const displayDate = display.date.toISOString().slice(0, 10).replaceAll('-', '');
  const start = `${displayDate}T${display.time.replace(':', '')}00`;
  const end = `${calendarEnd(fixture).date.replaceAll('-', '')}T${calendarEnd(fixture).time.replace(':', '')}00`;
  return ['BEGIN:VEVENT', `UID:fixture-${fixture.id || `${currentSport}-${currentTeam.id}-${fixture.date}-${fixture.time}-${fixture.opponent.replaceAll(' ', '-').toLowerCase()}`}@fixture`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART;TZID=${selectedTimeZone}:${start}`, `DTEND;TZID=${selectedTimeZone}:${end}`, `SUMMARY:${escapeICS(fixtureTitle(fixture))}`, fixture.venue ? `LOCATION:${escapeICS(fixture.venue)}` : null, `DESCRIPTION:${escapeICS(fixtureDescription(fixture))}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
}
function downloadCalendar(selected) {
  const calendarReady = calendarReadyFixtures(selected);
  if (!calendarReady.length) {
    sourceNote.textContent = 'No remaining fixtures have confirmed start times.';
    return;
  }
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//MyFixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...calendarReady.map(calendarEvent), 'END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' })); link.download = selected.length === 1 ? `myfixtures-${selected[0].date}.ics` : 'myfixtures-schedule.ics'; link.click(); URL.revokeObjectURL(link.href);
}
document.querySelector('#export-all').addEventListener('click', () => downloadCalendar(fixtures));
googleAllButton.addEventListener('click', addAllToGoogleCalendar);
document.querySelector('#mobile-sync').addEventListener('click', event => addFixturesToGoogleCalendar(fixtures, event.currentTarget, 'Games added to Google Calendar'));
document.querySelector('#mobile-export').addEventListener('click', () => downloadCalendar(fixtures));
document.querySelector('#mobile-add').addEventListener('click', () => document.querySelector('#fixture-dialog').showModal());
document.querySelectorAll('[data-fixture-filter]').forEach(button => button.addEventListener('click', () => { activeFixtureFilter = button.dataset.fixtureFilter; render(); }));
document.querySelector('#next-up-add').addEventListener('click', () => { if (nextUpFixture) openGoogleCalendar(nextUpFixture); });
document.querySelector('#add-fixture').addEventListener('click', () => document.querySelector('#fixture-dialog').showModal());
document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#fixture-dialog').close());
document.querySelector('#club-select').addEventListener('click', () => { renderSavedClubs(); clubDialog.showModal(); clubSearchInput.focus(); });
document.querySelector('#close-club-dialog').addEventListener('click', () => clubDialog.close());
document.querySelector('#club-search-form').addEventListener('submit', searchTeams);
if (sportMenuButton?.classList && sportMenu?.classList) {
  const setMenuOpen = open => { sportMenu.classList.toggle('open', open); sportMenu.inert = !open; sportMenuButton.setAttribute('aria-expanded', String(open)); };
  sportMenuButton.addEventListener('click', () => setMenuOpen(!sportMenu.classList.contains('open')));
  sportMenuButton.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true); sportMenu.querySelector('[aria-selected="true"]')?.focus(); } });
  sportMenu.addEventListener('keydown', event => {
    const options = [...sportMenu.querySelectorAll('[data-sport-value]')];
    const index = options.indexOf(document.activeElement);
    const target = event.key === 'ArrowDown' ? options[(index + 1) % options.length] : event.key === 'ArrowUp' ? options[(index - 1 + options.length) % options.length] : event.key === 'Home' ? options[0] : event.key === 'End' ? options.at(-1) : null;
    if (target) { event.preventDefault(); target.focus(); }
  });
  sportMenu.querySelectorAll('[data-sport-value]').forEach(button => button.addEventListener('click', () => {
    setMenuOpen(false);
    sportMenuButton.focus();
    if (sportSelect.value !== button.dataset.sportValue) { sportSelect.value = button.dataset.sportValue; sportSelect.dispatchEvent(new Event('change', { bubbles: true })); }
  }));
  document.addEventListener('click', event => { if (!sportMenuButton.parentElement.contains(event.target)) setMenuOpen(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && sportMenu.classList.contains('open')) { setMenuOpen(false); sportMenuButton.focus(); } });
}
sportSelect.addEventListener('change', async () => {
  currentSport = sportSelect.value;
  activeFixtureFilter = 'upcoming';
  localStorage.setItem('fixture-sport', currentSport);
  const savedForSport = readSavedClubs().find(team => (team.sport || 'soccer') === currentSport);
  currentTeam = savedForSport || defaultTeamForSport(currentSport);
  localStorage.setItem('fixture-current-team', JSON.stringify(currentTeam));
  fixtures.splice(0, fixtures.length);
  setTeamHeader();
  render();
  replayEntrance(document.querySelector('.hero'), 'sport-enter');
  replayEntrance(document.querySelector('.controls'), 'sport-enter');
  sourceNote.textContent = `Loading ${currentTeam.name} fixtures...`;
  await loadLiveFixtures();
});
timezoneSelect.addEventListener('change', () => { selectedTimeZone = timezoneSelect.value; localStorage.setItem('fixture-time-zone', selectedTimeZone); timezoneLabelElement.textContent = `Times shown in ${timezoneLabel()}`; render(); });
timezoneLabelElement.textContent = `Times shown in ${timezoneLabel()}`;
document.querySelector('#fixture-form').addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.target); fixtures.push({ date: data.get('date'), time: data.get('time'), opponent: data.get('opponent'), venue: data.get('venue') || 'Venue TBC', competition: data.get('competition') || 'Competition TBC', home: true }); event.target.reset(); document.querySelector('#fixture-dialog').close(); render(); });
document.querySelector('#retry-schedule').addEventListener('click', loadLiveFixtures);
setTeamHeader();
render();
loadLiveFixtures();
loadFollowedSlate();
window.addEventListener?.('pageshow', event => { if (event.persisted) loadFollowedSlate(); });
