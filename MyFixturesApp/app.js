const fixtures = [
  { date: '2026-09-06', time: '11:30', opponent: 'Chelsea', venue: 'Emirates Stadium', competition: 'Premier League', home: true },
  { date: '2026-09-09', time: '15:00', opponent: 'Napoli', venue: 'Stadio Diego Armando Maradona', competition: 'Champions League', home: false },
  { date: '2026-09-12', time: '15:00', opponent: 'Sunderland', venue: 'Stadium of Light', competition: 'Premier League', home: false },
  { date: '2026-09-15', time: '15:00', opponent: 'Ipswich Town', venue: 'Portman Road', competition: 'Carabao Cup', home: false },
  { date: '2026-09-19', time: '10:00', opponent: 'Brighton', venue: 'American Express Stadium', competition: 'Premier League', home: false },
  { date: '2026-10-03', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2026-10-21', time: '20:00', opponent: 'TBC', venue: 'TBC', competition: 'Champions League', home: true },
  { date: '2026-11-07', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: false },
  { date: '2026-11-28', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2026-12-05', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: false },
  { date: '2026-12-19', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2027-01-09', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'FA Cup', home: true },
  { date: '2027-01-23', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: false },
  { date: '2027-02-06', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2027-02-17', time: '20:00', opponent: 'TBC', venue: 'TBC', competition: 'Champions League', home: false },
  { date: '2027-03-06', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2027-03-20', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'FA Cup', home: true },
  { date: '2027-04-03', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: false },
  { date: '2027-04-17', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Champions League', home: true },
  { date: '2027-05-01', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: true },
  { date: '2027-05-15', time: '15:00', opponent: 'TBC', venue: 'TBC', competition: 'Premier League', home: false },
  { date: '2027-05-30', time: '16:00', opponent: 'TBC', venue: 'TBC', competition: 'Season final', home: true }
];
const appRelease = '20260915-mlb-series-1';
const fallbackFixtures = [...fixtures];
const f1Selection = { id: 'f1', sport: 'f1', name: 'Formula 1', abbreviation: 'F1', crest: 'https://city-png.b-cdn.net/thumbnail/thumbnail_public/uploads/preview/hd-f1-the-official-formula-1-transparent-png-701751712229525ajvwddtfme.png?v=2025092211' };
const nflSelection = { id: 18, sport: 'nfl', name: 'Philadelphia Eagles', abbreviation: 'PHI', crest: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' };
const mlbSelection = { id: 19, sport: 'mlb', name: 'New York Yankees', abbreviation: 'NYY', crest: 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png' };
const soccerSelection = { id: 57, sport: 'soccer', name: 'Arsenal', crest: 'https://crests.football-data.org/57.png' };
function defaultTeamForSport(sport) { return sport === 'f1' ? f1Selection : sport === 'nfl' ? nflSelection : sport === 'mlb' ? mlbSelection : soccerSelection; }
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
const teamMarkWrapper = document.querySelector('#team-mark-wrapper');
const googleClientId = '182131305802-0i417v1pr1tarbne0gofgqcvr2oqolfb.apps.googleusercontent.com';
const calendarScope = 'https://www.googleapis.com/auth/calendar.events';
let selectedTimeZone = localStorage.getItem('fixture-time-zone') || 'America/New_York';
const timezoneSelect = document.querySelector('#timezone-select');
timezoneSelect.value = selectedTimeZone;
sportSelect.value = currentSport;
function timezoneLabel() { return timezoneSelect.options[timezoneSelect.selectedIndex].text; }
function sportLabel() { return currentSport === 'f1' ? 'Formula 1' : currentSport === 'nfl' ? 'NFL' : currentSport === 'mlb' ? 'MLB' : 'Soccer'; }
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
  if (crest) return `<img class="${mini ? 'team-mini-crest' : 'club-mark'}" src="${crest}" alt="${team.name} logo">`;
  return `<span class="${mini ? 'team-mini-initials' : 'team-initials'}" aria-hidden="true">${teamInitials(team)}</span>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function fixtureTitle(fixture) { return fixture.title || (currentSport === 'f1' ? fixture.opponent : currentTeam.name + ' v ' + fixture.opponent + ' - ' + fixture.competition); }
function fixtureDescription(fixture) { return currentSport === 'f1' ? 'Formula 1 race. Calendar duration is estimated at two hours.' : fixture.competition + ' - ' + currentTeam.name + ' ' + (fixture.home ? 'home' : 'away') + (currentSport === 'mlb' ? ' game' : ' fixture'); }
function setTeamHeader() {
  const isF1 = currentSport === 'f1';
  const isMlb = currentSport === 'mlb';
  const season = currentSeason();
  document.querySelector('.hero-copy .eyebrow').textContent = isF1 ? 'YOUR RACEDAY, ORGANIZED' : isMlb ? 'YOUR BALLPARK, ORGANIZED' : 'Your matchday, organised';
  document.querySelector('.hero-copy h1').innerHTML = isF1 ? 'Never miss<br><em>lights out.</em>' : isMlb ? 'Never miss<br><em>first pitch.</em>' : 'Never miss<br><em>the kickoff.</em>';
  document.querySelector('.hero-copy .lede').textContent = isF1 ? 'A focused calendar for every Grand Prix. Add one race or the whole season in seconds.' : isMlb ? 'Upcoming games grouped into series. Add one game, a full series, or the rest of the season.' : 'A focused calendar for the fixtures of all your favorite teams. Add one match or the whole season in seconds.';
  document.querySelector('#club-select').disabled = isF1;
  document.querySelector('#add-fixture').hidden = isF1;
  document.querySelector('.section-label').textContent = isF1 ? 'Selected championship' : 'Selected team';
  document.querySelector('.topbar-meta > span:nth-child(2)').textContent = isF1 || isMlb ? 'Season ' + new Date().getUTCFullYear() : `Season ${season.label}`;
  document.querySelector('.section-heading .eyebrow').textContent = isF1 ? new Date().getUTCFullYear() + ' Formula 1 season' : isMlb ? `${new Date().getUTCFullYear()} MLB season - today forward` : `${season.label} season - July through June`;
  document.querySelector('.section-heading h2').textContent = isF1 ? 'Every Grand Prix.' : isMlb ? 'Every series. Every game.' : 'Every team. Every match.';
  document.title = 'MyFixtures | ' + currentTeam.name + ' calendar';
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
function calendarReadyFixtures(selected = fixtures) { return selected.filter(fixture => !fixture.timeTbd && !isPastFixture(fixture)); }
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
  return fixture.timeTbd || past
    ? `<button class="fixture-add fixture-add-disabled" type="button" disabled>${past ? 'Played' : 'Time TBD'}</button>`
    : `<button class="fixture-add" data-index="${index}">+ Google Calendar</button>`;
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
  list.innerHTML = renderedMlbSeries.map((series, seriesIndex) => {
    const fixturesInSeries = series.games.map(entry => entry.fixture);
    const readyGames = calendarReadyFixtures(fixturesInSeries);
    const allHome = fixturesInSeries.every(fixture => fixture.home);
    const allAway = fixturesInSeries.every(fixture => !fixture.home);
    const site = allHome ? 'Home series' : allAway ? 'Away series' : 'Split sites';
    const phase = fixturesInSeries.some(fixture => fixture.postseason) ? 'Postseason' : 'Regular season';
    const countLabel = fixturesInSeries.length === 1 ? 'Single game' : `${fixturesInSeries.length}-game series`;
    const tabs = series.games.map((entry, gameIndex) => `<button class="series-tab" id="series-${seriesIndex}-tab-${gameIndex}" type="button" role="tab" aria-selected="${gameIndex === 0}" aria-controls="series-${seriesIndex}-game-${gameIndex}" tabindex="${gameIndex === 0 ? '0' : '-1'}">Game ${gameIndex + 1}</button>`).join('');
    const panels = series.games.map((entry, gameIndex) => mlbGamePanel(entry, seriesIndex, gameIndex)).join('');
    return `<article class="series-card"><div class="series-heading"><div><p class="series-kicker">${escapeHtml(phase)} &middot; ${escapeHtml(seriesDateLabel(series))}</p><h3>${escapeHtml(countLabel)} vs ${escapeHtml(series.opponent)}</h3><p class="series-summary">${site}</p></div><button class="series-add" type="button" data-series-add="${seriesIndex}"${readyGames.length ? '' : ' disabled'}>+ Add series</button></div><div class="series-tabs" role="tablist" aria-label="Games against ${escapeHtml(series.opponent)}">${tabs}</div>${panels}</article>`;
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
function render() {
  const orderedFixtures = [...fixtures].sort((first, second) => (first.utcDate || first.date).localeCompare(second.utcDate || second.date));
  if (currentSport === 'mlb') {
    renderMlbFixtures(orderedFixtures);
  } else {
    renderedMlbSeries = [];
    list.innerHTML = orderedFixtures.map((fixture, index) => {
    const display = fixtureDisplay(fixture);
    const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, day: '2-digit', month: 'short' });
    const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: selectedTimeZone, weekday: 'short' });
    const past = isPastFixture(fixture);
    const kickoff = fixture.timeTbd ? 'TBD' : display.time;
    return `<article class="fixture${past ? ' fixture-past' : ''}"><div class="fixture-date"><strong>${dateFormat.format(display.date)}</strong><small>${dayFormat.format(display.date)}</small></div><div><div class="opponent">${escapeHtml(currentSport === 'f1' ? fixtureTitle(fixture) : currentTeam.name + ' v ' + fixture.opponent)}</div><div class="home-away">${currentSport === 'f1' ? 'Race' : fixture.home ? 'Home' : 'Away'} &middot; ${escapeHtml(fixture.competition)}</div></div><div class="fixture-meta"><b>${kickoff}</b>${fixture.venue && fixture.venue !== 'TBC' ? `<br>${escapeHtml(fixture.venue)}` : ''}</div>${fixtureActionButton(fixture, index)}</article>`;
    }).join('');
  }
  document.querySelectorAll('.fixture-add[data-index]').forEach(button => button.addEventListener('click', () => openGoogleCalendar(orderedFixtures[button.dataset.index])));
}
function formatFixtureForSelectedZone(timestamp) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: selectedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
async function loadLiveFixtures() {
  const loadId = ++fixtureLoadId;
  try {
    const dateRange = fixtureDateRange();
    const competitions = Array.isArray(currentTeam.competitions) && currentTeam.competitions.length ? `&competitions=${encodeURIComponent(currentTeam.competitions.join(','))}` : '';
    const identity = `&teamName=${encodeURIComponent(currentTeam.fullName || currentTeam.name || '')}&teamAbbreviation=${encodeURIComponent(currentTeam.abbreviation || '')}`;
    const response = await fetch(`/api/fixtures?sport=${encodeURIComponent(currentSport)}&team=${currentTeam.id}&${dateRange}${competitions}${identity}&release=${appRelease}`);
    const payload = await response.json();
    if (loadId !== fixtureLoadId) return;
    if (!response.ok) throw new Error(payload.error || `Fixture API returned ${response.status}`);
    const liveFixtures = payload.fixtures;
    if (!Array.isArray(liveFixtures) || (liveFixtures.length === 0 && currentSport !== 'f1' && currentSport !== 'mlb')) throw new Error(`No live fixtures returned (${JSON.stringify(payload.errors || {})})`);
    fixtures.splice(0, fixtures.length, ...liveFixtures.map(item => {
      if (item.utcDate && item.opponent) {
        const kickoff = formatFixtureForSelectedZone(item.utcDate);
        return { ...item, date: kickoff.date, time: kickoff.time };
      }
      const kickoff = formatFixtureForSelectedZone(item.utcDate);
      return { ...kickoff, utcDate: item.utcDate, opponent: item.homeTeam.id === currentTeam.id ? item.awayTeam.name : item.homeTeam.name, venue: item.venue || '', competition: item.competition.name, home: item.homeTeam.id === currentTeam.id };
    }));
    setTeamHeader();
    const source = currentSport === 'soccer' && payload.source === 'football-data+espn' ? '<a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a> and ESPN' : currentSport === 'soccer' && payload.source === 'espn' ? 'ESPN schedule data' : currentSport === 'nfl' && payload.provider === 'espn' ? 'ESPN schedule data' : currentSport === 'f1' && payload.provider === 'jolpica' ? '<a href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">Jolpica F1</a>' : (currentSport === 'nfl' || currentSport === 'f1' || currentSport === 'mlb') ? '<a href="https://www.balldontlie.io/" target="_blank" rel="noreferrer">BALLDONTLIE</a>' : '<a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>';
    sourceNote.innerHTML = `Live ${sportLabel()} schedule from ${source}. Times converted to ${timezoneLabel()}.${currentSport === 'mlb' ? ' Showing games from today forward, including determined postseason matchups.' : ''}`;
    if (currentSport === 'f1' && !liveFixtures.length) sourceNote.textContent = 'No upcoming Grand Prix races are available for this season.';
    if (currentSport === 'mlb' && !liveFixtures.length) sourceNote.textContent = 'No remaining MLB games are currently scheduled for this team.';
    render();
  } catch (error) {
    if (loadId !== fixtureLoadId) return;
    fixtures.splice(0, fixtures.length, ...(currentSport === 'soccer' && currentTeam.id === 57 ? fallbackFixtures : []));
    render();
    sourceNote.innerHTML = currentSport === 'soccer' && currentTeam.id === 57 ? 'Live football-data.org feed unavailable. Showing verified Arsenal entries. <a href="https://www.arsenal.com/fixtures/men/fixtures" target="_blank" rel="noreferrer">Check Arsenal.com</a>.' : `No fixtures available for ${currentTeam.name}. Try another team or check the ${sportLabel()} provider.`;
    if (currentSport === 'f1') sourceNote.textContent = error.message;
    console.info('Live fixtures unavailable; showing the local schedule.', error);
  }
}
function escapeICS(value) { return String(value).replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n'); }
function calendarEnd(fixture) {
  const durationMinutes = currentSport === 'mlb' || currentSport === 'nfl' ? 180 : 120;
  return formatFixtureForSelectedZone(fixtureSortTime(fixture) + durationMinutes * 60 * 1000);
}
function googleCalendarUrl(fixture) {
  const display = fixtureDisplay(fixture);
  const start = `${display.date.toISOString().slice(0, 10).replaceAll('-', '')}T${display.time.replace(':', '')}00`;
  const end = `${calendarEnd(fixture).date.replaceAll('-', '')}T${calendarEnd(fixture).time.replace(':', '')}00`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: fixtureTitle(fixture), dates: `${start}/${end}`, ctz: selectedTimeZone, details: fixtureDescription(fixture), ...(fixture.venue && fixture.venue !== 'TBC' ? { location: fixture.venue } : {}) });
  return `https://calendar.google.com/calendar/render?${params}`;
}
function openGoogleCalendar(fixture) {
  if (!fixture || fixture.timeTbd || isPastFixture(fixture)) return;
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
    const token = await getGoogleAccessToken();
    const orderedFixtures = calendarReadyFixtures(selectedFixtures).sort((first, second) => fixtureSortTime(first) - fixtureSortTime(second));
    if (!orderedFixtures.length) throw new Error('No remaining fixtures have confirmed kickoff times.');
    for (let index = 0; index < orderedFixtures.length; index += 1) {
      button.innerHTML = `<span>…</span> Adding ${index + 1} of ${orderedFixtures.length}`;
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(googleCalendarEvent(orderedFixtures[index])) });
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
  savedClubs.innerHTML = clubs.length ? clubs.map(team => `<div class="saved-club" data-team="${team.id}"><button class="saved-club-main" data-open-team="${team.id}">${teamMark(team, true)}${team.name}</button><button class="saved-club-remove" data-remove-team="${team.id}" type="button" aria-label="Remove ${team.name}">×</button></div>`).join('') : `<span class="timezone">No saved ${sportLabel()} teams yet</span>`;
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
    clubResults.innerHTML = teams.length ? teams.map(team => `<button class="club-result" data-team="${team.id}"><span class="club-result-main">${teamMark(team, true)}${team.name}</span><span>＋ Save</span></button>`).join('') : '<span class="timezone">No teams found</span>';
    clubResults.querySelectorAll('.club-result').forEach(button => button.addEventListener('click', () => selectTeam(teams.find(team => String(team.id) === button.dataset.team))));
  } catch (error) { clubResults.innerHTML = `<span class="timezone">${error.message}</span>`; }
}
async function selectTeam(team) {
  if (!team) return;
  const normalizedTeam = { ...team, sport: team.sport || currentSport };
  const clubs = readSavedClubs().filter(saved => `${saved.sport || 'soccer'}:${saved.id}` !== `${normalizedTeam.sport}:${normalizedTeam.id}`);
  writeSavedClubs([normalizedTeam, ...clubs].slice(0, 12));
  currentTeam = normalizedTeam;
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
  return ['BEGIN:VEVENT', `UID:fixture-${fixture.date}-${fixture.opponent.replaceAll(' ', '-').toLowerCase()}@fixture`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART;TZID=${selectedTimeZone}:${start}`, `DTEND;TZID=${selectedTimeZone}:${end}`, `SUMMARY:${escapeICS(fixtureTitle(fixture))}`, fixture.venue ? `LOCATION:${escapeICS(fixture.venue)}` : null, `DESCRIPTION:${escapeICS(fixtureDescription(fixture))}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
}
function downloadCalendar(selected) {
  const calendarReady = calendarReadyFixtures(selected);
  if (!calendarReady.length) {
    sourceNote.textContent = 'No remaining fixtures have confirmed kickoff times.';
    return;
  }
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//MyFixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...calendarReady.map(calendarEvent), 'END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' })); link.download = selected.length === 1 ? `myfixtures-${selected[0].date}.ics` : 'myfixtures-schedule.ics'; link.click(); URL.revokeObjectURL(link.href);
}
document.querySelector('#export-all').addEventListener('click', () => downloadCalendar(fixtures));
googleAllButton.addEventListener('click', addAllToGoogleCalendar);
document.querySelector('#add-fixture').addEventListener('click', () => document.querySelector('#fixture-dialog').showModal());
document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#fixture-dialog').close());
document.querySelector('#club-select').addEventListener('click', () => { renderSavedClubs(); clubDialog.showModal(); clubSearchInput.focus(); });
document.querySelector('#close-club-dialog').addEventListener('click', () => clubDialog.close());
document.querySelector('#club-search-form').addEventListener('submit', searchTeams);
sportSelect.addEventListener('change', async () => {
  currentSport = sportSelect.value;
  localStorage.setItem('fixture-sport', currentSport);
  const savedForSport = readSavedClubs().find(team => (team.sport || 'soccer') === currentSport);
  currentTeam = savedForSport || defaultTeamForSport(currentSport);
  localStorage.setItem('fixture-current-team', JSON.stringify(currentTeam));
  fixtures.splice(0, fixtures.length);
  setTeamHeader();
  render();
  sourceNote.textContent = `Loading ${currentTeam.name} fixtures...`;
  await loadLiveFixtures();
});
timezoneSelect.addEventListener('change', () => { selectedTimeZone = timezoneSelect.value; localStorage.setItem('fixture-time-zone', selectedTimeZone); timezoneLabelElement.textContent = `Times shown in ${timezoneLabel()}`; render(); });
timezoneLabelElement.textContent = `Times shown in ${timezoneLabel()}`;
document.querySelector('#fixture-form').addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.target); fixtures.push({ date: data.get('date'), time: data.get('time'), opponent: data.get('opponent'), venue: data.get('venue') || 'Venue TBC', competition: data.get('competition') || 'Competition TBC', home: true }); event.target.reset(); document.querySelector('#fixture-dialog').close(); render(); });
if (currentSport !== 'soccer') fixtures.splice(0, fixtures.length);
setTeamHeader();
render();
loadLiveFixtures();
