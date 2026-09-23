import { conflictKeys, filterGames, gameDate } from './calendar-view.mjs';

const $ = id => document.getElementById(id);
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
  includePostseason: $('include-postseason').checked, reminder: Number($('calendar-reminder').value), revision }; }
function populate(value) {
  teams = value.teams; renderTeams();
  $('calendar-name').value = value.name;
  if (![...$('living-timezone').options].some(o => o.value === value.timeZone)) $('living-timezone').add(new Option(value.timeZone, value.timeZone));
  $('living-timezone').value = value.timeZone;
  $('include-completed').checked = value.includeCompleted;
  $('include-preseason').checked = value.includePreseason;
  $('include-postseason').checked = value.includePostseason;
  $('calendar-reminder').value = String(value.reminder);
}
function links() {
  $('subscription-panel').hidden = !id || stopped;
  if (!id) return;
  const feed = `${location.origin}/calendar/${id}.ics`;
  $('feed-url').value = feed;
  $('webcal-link').href = feed.replace(/^https?:/, 'webcal:');
  const ready = state?.ready === true;
  $('copy-feed').disabled = !ready;
  $('feed-readiness').textContent = ready ? 'Your feed is ready to subscribe.' : 'Preparing the first schedules. Subscription buttons become available when all selected teams are ready.';
  for (const [control, href] of [['webcal-link', feed.replace(/^https?:/, 'webcal:')], ['google-subscribe', 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl']]) {
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
  const games = filterGames(state.games || [], { period: $('week-period').value, sport: $('week-sport').value, postseasonOnly: $('week-postseason').checked, timeZone });
  const conflicts = conflictKeys(state.games || []);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  $('overlap-note').hidden = !games.some(g => conflicts.has(g.key));
  $('week-games').innerHTML = games.length ? games.map(game => {
    const cancelled = /cancel|abandon/i.test(game.status || '');
    const pending = game.timeTbd || /postpon|suspend|^ppd$/i.test(game.status || '');
    const date = gameDate(game, timeZone);
    return `<article class="week-card${cancelled ? ' cancelled-game' : ''}"><time datetime="${escape(date)}">${escape(formatter.format(new Date(`${date}T12:00:00Z`)))}<span>${pending ? 'Time TBD' : escape(time.format(new Date(game.utcDate)))}</span></time><div><small>${escape(game.sport)} · ${escape(game.competition)}</small><h3>${escape(game.title)}</h3>${game.venue ? `<p>${escape(game.venue)}</p>` : ''}${game.selectedTeams.length > 1 ? '<p>Both of your teams · one calendar event</p>' : ''}${cancelled ? '<span class="status-badge">Cancelled / removed</span>' : pending ? '<span class="status-badge">Awaiting confirmed time</span>' : conflicts.has(game.key) ? '<span class="overlap-badge">Overlaps another game</span>' : ''}</div></article>`;
  }).join('') : '<div class="empty-week">No games match this view. Try Full season or adjust your filters.</div>';
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
