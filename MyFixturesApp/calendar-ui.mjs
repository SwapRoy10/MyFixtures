import { conflictKeys, filterGames, gameDate, groupWeekSeries, googleGameUrl, describeChange } from './calendar-view.mjs';
import { confirmedOpponent, localDate } from './schedule-common.mjs';
import { calendarGuides } from './calendar-guides.mjs';

const $ = id => document.getElementById(id);
const replayEntrance = element => { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return; element.classList.remove('content-enter'); void element.offsetWidth; element.classList.add('content-enter'); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = team => `${team.sport || 'soccer'}:${team.id}`;
const stored = name => { try { return JSON.parse(localStorage.getItem(name) || 'null'); } catch { return null; } };
let credentials = stored('living-calendar-owner');
const management = location.hash.match(/^#manage=([a-f0-9]{32})\.([a-f0-9]{32})$/);
if (management) {
  credentials = { id: management[1], editToken: management[2] };
  localStorage.setItem('living-calendar-owner', JSON.stringify(credentials));
  history.replaceState(null, '', `/calendar.html?id=${credentials.id}`);
}
const requested = new URL(location.href).searchParams.get('id');
let id = requested || credentials?.id;
let canEdit = !id || credentials?.id === id;
let revision = 0;
let state = null;
let timer;
let searchGeneration = 0;
let stopped = false;
let loading = false;
let loadGeneration = 0;
let dirty = false;
let chosenCompetitions = [];
const openSeries = new Set(), activeGames = new Map();
let activeWeekTeam = 'all';
let teams = (stored('fixture-saved-clubs') || []).map(t => ({ ...t, sport: t.sport || 'soccer' })).slice(0, 12);
if (!teams.length) {
  const selected = stored('fixture-current-team');
  teams = selected ? [{ ...selected, sport: selected.sport || 'soccer' }] : [{ id: 57, sport: 'soccer', name: 'Arsenal', abbreviation: 'ARS' }];
}
const initialZone = localStorage.getItem('fixture-time-zone');
if (initialZone && [...$('living-timezone').options].some(o => o.value === initialZone)) $('living-timezone').value = initialZone;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(25000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to load your calendar. Please retry.');
  return body;
}
function renderTeams() {
  $('selected-count').textContent = `${teams.length} / 12`;
  $('selected-teams').innerHTML = teams.map((team, index) => `<li><span><small>${escape(team.sport)}</small>${escape(team.name)}</span>${canEdit && !stopped ? `<button type="button" data-remove="${index}" aria-label="Remove ${escape(team.name)}">×</button>` : ''}</li>`).join('');
  $('selected-teams').querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => { teams.splice(Number(button.dataset.remove), 1); dirty = true; renderTeams(); }));
}
function addTeam(team) {
  if (teams.some(t => key(t) === key(team))) { $('settings-message').textContent = 'That team is already selected.'; return; }
  if (teams.length >= 12) { $('settings-message').textContent = 'You can follow up to 12 teams or championships.'; return; }
  teams.push(team); dirty = true; renderTeams(); $('settings-message').textContent = `${team.name} added. Save your calendar to apply the selection.`;
}
$('search-sport').addEventListener('change', () => {
  searchGeneration++;
  $('team-search-results').innerHTML = '';
  $('living-team-search').disabled = $('search-sport').value === 'f1';
  $('living-team-search').placeholder = $('search-sport').value === 'f1' ? 'Entire Formula 1 season' : 'Team name or abbreviation';
});
$('team-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const sport = $('search-sport').value;
  if (sport === 'f1') { addTeam({ id: 'f1', sport, name: 'Formula 1', abbreviation: 'F1' }); return; }
  const search = $('living-team-search').value.trim();
  if (!search) { $('living-team-search').focus(); return; }
  const generation = ++searchGeneration;
  $('team-search-results').textContent = 'Searching…';
  try {
    const matches = await api(`/api/teams?${new URLSearchParams({ sport, search })}`);
    if (generation !== searchGeneration) return;
    $('team-search-results').innerHTML = matches.length ? matches.slice(0, 20).map((team, index) => `<button class="team-result" type="button" data-result="${index}">+ ${escape(team.name)}</button>`).join('') : '<p>No teams found.</p>';
    $('team-search-results').querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => addTeam(matches[Number(button.dataset.result)])));
  } catch (error) { if (generation === searchGeneration) $('team-search-results').textContent = error.message; }
});

function config() { return { teams, name: $('calendar-name').value.trim(), timeZone: $('living-timezone').value,
  includeCompleted: $('include-completed').checked, includePreseason: $('include-preseason').checked,
  includePostseason: $('include-postseason').checked, reminder: Number($('calendar-reminder').value), revision,
  venueFilter: $('venue-filter').value, dateFrom: $('calendar-date-from').value, dateTo: $('calendar-date-to').value,
  competitionFilters: $('competition-mode').value === 'selected' ? chosenCompetitions : [] }; }
function populate(value) {
  teams = value.teams; renderTeams();
  $('calendar-name').value = value.name;
  if (![...$('living-timezone').options].some(o => o.value === value.timeZone)) $('living-timezone').add(new Option(value.timeZone, value.timeZone));
  $('living-timezone').value = value.timeZone;
  $('include-completed').checked = value.includeCompleted;
  $('include-preseason').checked = value.includePreseason;
  $('include-postseason').checked = value.includePostseason;
  $('calendar-reminder').value = String(value.reminder);
  $('venue-filter').value = value.venueFilter || 'all';
  $('calendar-date-from').value = value.dateFrom || '';
  $('calendar-date-to').value = value.dateTo || '';
  chosenCompetitions = [...(value.competitionFilters || [])];
  $('competition-mode').value = chosenCompetitions.length ? 'selected' : 'all';
  renderCompetitions();
}
function renderCompetitions() {
  const options = new Map((state?.competitions || []).map(c => [c.key, c]));
  for (const code of chosenCompetitions) if (!options.has(code)) options.set(code, { key: code, name: `${code} (not currently published)`, sport: '' });
  $('competition-choices').hidden = $('competition-mode').value !== 'selected';
  $('competition-choices').innerHTML = [...options.values()].map(c => `<label><input type="checkbox" value="${escape(c.key)}" ${chosenCompetitions.includes(c.key) ? 'checked' : ''} ${!canEdit || stopped ? 'disabled' : ''}> ${escape(c.sport.toUpperCase())} · ${escape(c.name)}</label>`).join('');
  $('competition-note').textContent = options.size ? 'Selections affect both My Week and your subscription. Only “All competitions” automatically includes newly added competition types.' : 'Create your calendar first. Competition choices appear when its schedules load.';
  $('competition-choices').querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    chosenCompetitions = [...$('competition-choices').querySelectorAll('input:checked')].map(c => c.value); dirty = true;
  }));
}
$('competition-mode').addEventListener('change', () => { dirty = true; renderCompetitions(); });
function renderGuide() {
  const guide = calendarGuides[$('calendar-app').value] || calendarGuides.google;
  $('subscription-instructions').innerHTML = `<ol>${guide.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><p>${escape(guide.note)}</p><a href="${escape(guide.source)}" target="_blank" rel="noreferrer">Official setup instructions</a>`;
}
$('calendar-app').addEventListener('change', renderGuide);
$('imported-before').addEventListener('change', () => { $('duplicate-help').hidden = !$('imported-before').checked; });
renderGuide();
function links() {
  $('subscription-panel').hidden = !id || stopped;
  if (!id) return;
  const feed = `${location.origin}/calendar/${id}.ics`;
  $('feed-url').value = feed;
  $('webcal-link').href = feed.replace(/^https?:/, 'webcal:');
  const ready = state?.ready === true;
  $('copy-feed').disabled = !ready;
  $('feed-readiness').textContent = ready ? 'Your feed is ready to subscribe.' : 'Preparing the first schedules. Subscription buttons become available when all selected teams are ready.';
  for (const [control, href] of [['webcal-link', feed.replace(/^https?:/, 'webcal:')], ['google-subscribe', 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl'], ['download-once', feed]]) {
    if (ready) $(control).setAttribute('href', href); else $(control).removeAttribute('href');
    $(control).setAttribute('aria-disabled', String(!ready));
  }
  $('share-url').value = `${location.origin}/calendar.html?id=${id}`;
  $('manage-url').value = canEdit ? `${location.origin}/calendar.html#manage=${id}.${credentials.editToken}` : '';
  $('manage-url').hidden = !canEdit;
  $('copy-manage').hidden = !canEdit;
  $('manage-details').hidden = !canEdit;
  $('refresh-calendar').hidden = stopped;
  $('stop-calendar').hidden = !canEdit || stopped;
  $('save-calendar').textContent = 'Save calendar settings';
}
function renderDashboard() {
  if (!state) return;
  const timeZone = $('living-timezone').value;
  const followedTeams = state.config?.teams || teams;
  if (activeWeekTeam !== 'all' && !followedTeams.some(team => key(team) === activeWeekTeam)) activeWeekTeam = 'all';
  const teamVisible = game => activeWeekTeam === 'all' || (game.selectedTeams || []).includes(activeWeekTeam);
  const periodGames = filterGames(state.games || [], { period: $('week-period').value, sport: $('week-sport').value, postseasonOnly: $('week-postseason').checked, timeZone });
  const games = periodGames.filter(teamVisible);
  const outlookGames = filterGames(state.games || [], { period: 'season', sport: $('week-sport').value, postseasonOnly: $('week-postseason').checked, timeZone }).filter(teamVisible);
  $('week-fixture-count').textContent = `${games.length} ${games.length === 1 ? 'fixture' : 'fixtures'} in this view`;
  $('week-team-filters').innerHTML = `<button type="button" data-week-team="all" aria-pressed="${activeWeekTeam === 'all'}">All teams (${periodGames.length})</button>${followedTeams.map(team => `<button type="button" data-week-team="${escape(key(team))}" aria-pressed="${activeWeekTeam === key(team)}">${escape(team.name)}</button>`).join('')}`;
  $('week-team-filters').querySelectorAll('[data-week-team]').forEach(button => button.addEventListener('click', () => { activeWeekTeam = button.dataset.weekTeam; renderDashboard(); }));
  const today = localDate(new Date().toISOString(), timeZone);
  const previousSlate = $('week-strip').innerHTML;
  $('week-strip').innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    const dayGames = outlookGames.filter(game => gameDate(game, timeZone) === day).sort((first, second) => Number(Boolean(first.timeTbd)) - Number(Boolean(second.timeTbd)) || Date.parse(first.utcDate) - Date.parse(second.utcDate));
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(date);
    const cards = dayGames.map(game => {
      const cancelled = /cancel|abandon|^cncl$/i.test(game.status || '');
      const pending = game.timeTbd || /postpon|suspend|^ppd$/i.test(game.status || '');
      const kickoff = cancelled ? 'Canceled' : pending ? 'TBD' : new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(game.utcDate));
      return `<div class="slate-game"><small>${escape(game.sport.toUpperCase())}</small><strong>${escape(game.title)}</strong><span>${escape(kickoff)}</span></div>`;
    }).join('');
    return `<div class="slate-day${index === 0 ? ' today' : ''}" aria-label="${escape(day)}: ${dayGames.length} ${dayGames.length === 1 ? 'game' : 'games'}"><div class="slate-date"><strong>${label} ${date.getUTCDate()}</strong><span>${dayGames.length ? `${dayGames.length} ${dayGames.length === 1 ? 'game' : 'games'}` : 'Rest'}</span></div>${cards || '<span class="slate-rest">No games</span>'}</div>`;
  }).join('');
  const conflicts = conflictKeys(games);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  $('overlap-note').hidden = !games.some(g => conflicts.has(g.key));
  const card = game => {
    const cancelled = /cancel|abandon|^cncl$/i.test(game.status || '');
    const pending = game.timeTbd || !confirmedOpponent(game) || /postpon|suspend|^ppd$/i.test(game.status || '');
    const date = gameDate(game, timeZone);
    const google = googleGameUrl(game);
    return `<article class="week-card${cancelled ? ' cancelled-game' : ''}"><time datetime="${escape(date)}">${escape(formatter.format(new Date(`${date}T12:00:00Z`)))}<span>${pending ? 'Unconfirmed' : escape(time.format(new Date(game.utcDate)))}</span></time><div><small>${escape(game.sport)} · ${escape(game.competition)}</small><h3>${escape(game.title)}</h3>${game.venue ? `<p>${escape(game.venue)}</p>` : ''}${game.selectedTeams.length > 1 ? '<p>Both of your teams · one calendar event</p>' : ''}${cancelled ? '<span class="status-badge">Cancelled / removed</span>' : pending ? '<span class="status-badge">Awaiting confirmed time or matchup</span>' : conflicts.has(game.key) ? '<span class="overlap-badge">Overlaps another game</span>' : ''}${google ? `<p><a href="${escape(google)}" target="_blank" rel="noreferrer">Add once to Google Calendar</a> <small>Skip this if you already subscribe.</small></p>` : ''}</div></article>`;
  };
  const visible = new Set(games.map(g => g.key));
  const groups = groupWeekSeries(state.games || []).map(group => ({ ...group, shown: group.games.map((game, index) => ({ game, number: index + 1 })).filter(({ game }) => visible.has(game.key)) })).filter(g => g.shown.length);
  const previousAgenda = $('week-games').innerHTML;
  $('week-games').innerHTML = groups.length ? groups.map((group, index) => {
    if (group.games.length === 1) return card(group.shown[0].game);
    const active = group.shown.some(g => g.game.key === activeGames.get(group.key)) ? activeGames.get(group.key) : group.shown[0].game.key;
    const tabs = group.shown.map(({ game, number }) => `<button type="button" role="tab" id="week-${index}-${number}-tab" aria-controls="week-${index}-${number}-panel" aria-selected="${game.key === active}" tabindex="${game.key === active ? '0' : '-1'}" data-week-tab="${escape(game.key)}">Game ${number}</button>`).join('');
    const panels = group.shown.map(({ game, number }) => `<div role="tabpanel" id="week-${index}-${number}-panel" aria-labelledby="week-${index}-${number}-tab" ${game.key === active ? '' : 'hidden'}>${card(game)}</div>`).join('');
    return `<details class="week-series" data-series-key="${escape(group.key)}" ${openSeries.has(group.key) ? 'open' : ''}><summary>${escape(group.games[0].title)} <span>${group.shown.length} of ${group.games.length} games in this view</span></summary><p class="field-note">MLB series inferred from consecutive published matchups. Game numbers refer to the currently loaded series; calendar entries remain individual games.</p><div class="week-tabs" role="tablist" aria-label="Games in ${escape(group.games[0].title)}">${tabs}</div>${panels}</details>`;
  }).join('') : '<div class="empty-week">No games match this view. Try Full season or adjust your saved calendar filters.</div>';
  if (previousSlate !== $('week-strip').innerHTML) replayEntrance($('week-strip'));
  if (previousAgenda !== $('week-games').innerHTML) replayEntrance($('week-games'));
  $('week-games').querySelectorAll('.week-series').forEach(series => {
    series.addEventListener('toggle', () => { if (series.open) openSeries.add(series.dataset.seriesKey); else openSeries.delete(series.dataset.seriesKey); });
    const tabs = [...series.querySelectorAll('[role="tab"]')];
    const activate = tab => {
      activeGames.set(series.dataset.seriesKey, tab.dataset.weekTab);
      tabs.forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
      series.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== tab.getAttribute('aria-controls'); });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
        if (target) { event.preventDefault(); activate(target); target.focus(); }
      });
    });
  });
  renderInsights(timeZone);
}

function renderInsights(timeZone) {
  const date = value => value ? new Date(value).toLocaleString(undefined, { timeZone }) : 'Not checked yet';
  const statuses = { current: 'Published schedule loaded', preparing: 'Preparing first schedule', unavailable: 'Provider unavailable', stale: 'Update delayed — saved schedule retained', partial: 'Partial coverage — some sources missing', unpublished: 'No games published yet', 'season-pending': 'New season — awaiting first successful refresh' };
  const reasons = { 'rate-limit': 'Provider rate limit reached; retrying automatically.', access: 'Provider access needs attention.', timeout: 'Provider request timed out; retrying automatically.', provider: 'Provider response unavailable or invalid; retrying automatically.' };
  $('team-health').innerHTML = (state.health || []).map(h => `<article class="health-card"><h3>${escape(h.name)}</h3><p>${escape(statuses[h.state] || h.state)}</p><p>Season ${escape(h.season.from)} to ${escape(h.season.to)} · ${h.games} published games · ${h.unconfirmed} unconfirmed</p><p>Last check: ${escape(date(h.checkedAt))}<br>Last successful update: ${escape(date(h.updated))}</p><p>${escape(h.coverage === 'published' ? 'Published feed retrieved. Undetermined games may appear later.' : h.coverage === 'partial' ? 'Incomplete source coverage.' : 'Full coverage cannot be independently confirmed.')}${h.reason ? ` ${escape(reasons[h.reason] || '')}` : ''}</p></article>`).join('') || '<p>Create your calendar to see per-team status.</p>';
  $('changes-count').textContent = state.changes?.length ? `(${state.changes.length})` : '';
  $('schedule-changes').innerHTML = state.changes?.length ? state.changes.map(change => `<article class="change-card"><h3>${escape(change.title)}</h3><p>${escape(describeChange(change, timeZone))}</p><small>Detected ${escape(date(change.at))} · ${escape(change.competition)}</small></article>`).join('') : '<p>No provider changes recorded yet. The first refresh establishes the baseline.</p>';
}

async function loadCalendar({ populateSettings = false } = {}) {
  if (!id || stopped || loading) return;
  loading = true;
  const generation = ++loadGeneration;
  clearTimeout(timer);
  try {
    const data = await api(`/api/calendars/${id}`);
    if (generation !== loadGeneration) return;
    state = data; stopped = data.revoked;
    if (populateSettings || !dirty) { revision = data.revision; populate(data.config); }
    if (stopped) {
      $('schedule-status').textContent = 'This subscription has been stopped. Remove it from your calendar app when you no longer need it.';
      $('week-games').innerHTML = '';
      $('save-calendar').disabled = true;
      $('stop-calendar').hidden = true;
      links();
      return;
    }
    const updated = data.updated ? new Date(data.updated).toLocaleString(undefined, { timeZone: $('living-timezone').value }) : '';
    $('schedule-status').textContent = data.pending.length ? `Preparing ${data.pending.join(', ')}. Schedules load in the background and may take a few minutes. You can leave this page open or return later.` :
      `${data.games.length} games across ${data.config.teams.length} selections. Updated ${updated}.${data.delayed.length ? ` Update delayed for ${data.delayed.join(', ')}; showing the last successful schedule.` : ''}`;
    links(); renderDashboard();
    timer = setTimeout(() => loadCalendar(), data.refreshSeconds * 1000);
  } catch (error) {
    if (generation !== loadGeneration) return;
    $('schedule-status').textContent = `${error.message} Your last displayed schedule is preserved.`;
    timer = setTimeout(() => loadCalendar(), 30000);
  } finally { if (generation === loadGeneration) loading = false; }
}
$('calendar-settings').addEventListener('input', () => { dirty = true; });
$('calendar-settings').addEventListener('submit', async event => {
  event.preventDefault(); if (!canEdit || stopped) return;
  if (!teams.length) { $('settings-message').textContent = 'Choose at least one team or championship.'; return; }
  if ($('competition-mode').value === 'selected' && !chosenCompetitions.length) { $('settings-message').textContent = 'Choose at least one competition, or select All competitions.'; return; }
  if ($('calendar-date-from').value && $('calendar-date-to').value && $('calendar-date-from').value > $('calendar-date-to').value) { $('settings-message').textContent = 'The start date must be before the end date.'; return; }
  $('save-calendar').disabled = true;
  loadGeneration++; loading = false; clearTimeout(timer);
  $('settings-message').textContent = 'Saving your calendar…';
  try {
    const body = await api(id ? `/api/calendars/${id}` : '/api/calendars', { method: id ? 'PUT' : 'POST', body: JSON.stringify(config()),
      headers: id ? { authorization: `Bearer ${credentials.editToken}` } : {} });
    if (!id) { id = body.id; credentials = { id, editToken: body.editToken }; localStorage.setItem('living-calendar-owner', JSON.stringify(credentials)); history.replaceState(null, '', `/calendar.html?id=${id}`); }
    revision = body.revision; dirty = false;
    if (state) state.ready = false;
    $('settings-message').textContent = 'Saved. Your subscription link stays the same when you change settings.';
    links(); await loadCalendar();
  } catch (error) { $('settings-message').textContent = error.message; }
  finally { $('save-calendar').disabled = false; }
});
$('stop-calendar').addEventListener('click', async () => {
  if (!confirm('Stop this subscription? Existing subscribers will receive withdrawn events. You can create a new calendar afterward.')) return;
  loadGeneration++; loading = false; clearTimeout(timer);
  try {
    await api(`/api/calendars/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${credentials.editToken}` } });
    clearTimeout(timer); localStorage.removeItem('living-calendar-owner');
    stopped = true; links();
    $('settings-message').textContent = 'Subscription stopped. Reload this page without its calendar ID to create a new one.';
    $('week-games').innerHTML = '<p>Subscription stopped. <a href="/calendar.html">Create a new calendar</a>.</p>';
    $('schedule-status').textContent = 'Calendar apps will withdraw the events when they next refresh.';
    $('save-calendar').disabled = true;
  } catch (error) { $('settings-message').textContent = error.message; }
});
for (const [button, input, message] of [['copy-feed', 'feed-url', 'Calendar link copied.'], ['copy-manage', 'manage-url', 'Private management link copied. Keep it somewhere safe.'], ['copy-share', 'share-url', 'Dashboard link copied.']]) {
  $(button).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(input).value); $('copy-message').textContent = message; }
    catch { $(input).focus(); $(input).select(); $('copy-message').textContent = 'Select and copy the highlighted link.'; }
  });
}
for (const control of ['week-period', 'week-sport', 'week-postseason', 'living-timezone']) $(control).addEventListener('change', renderDashboard);
$('refresh-calendar').addEventListener('click', () => loadCalendar());
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else loadCalendar(); });
if (!canEdit) {
  $('ownership-note').textContent = 'You are viewing a shared calendar. Use its private management link to change the subscription.';
  $('team-search-form').hidden = true;
  $('calendar-settings').querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
  $('living-timezone').disabled = false;
}
renderTeams();
if (id) { $('schedule-status').textContent = 'Loading your Living Calendar…'; loadCalendar({ populateSettings: true }); }
