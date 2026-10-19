import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const fixture = (id, utcDate, overrides = {}) => ({ id, sport: 'soccer', utcDate, opponent: `Opponent ${id}`, competition: 'Premier League', venue: 'Test Ground', home: true, timeTbd: false, ...overrides });

function loadApp(fixtures) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      const listeners = {};
      elements.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, options: [{ text: 'Eastern Time' }], selectedIndex: 0, listeners,
        addEventListener(type, handler) { listeners[type] = handler; }, querySelectorAll: () => [], click() {}, close() {} });
    }
    return elements.get(selector);
  };
  const opened = [];
  const context = vm.createContext({ console, Intl, Date, URLSearchParams, Blob, setTimeout,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('a') },
    window: { open: url => { opened.push(String(url)); return null; } },
    open: url => { opened.push(String(url)); return null; },
    fetch: async () => ({ ok: true, json: async () => ({ fixtures, provider: 'football-data' }) })
  });
  vm.runInContext(app, context);
  return { context, element, opened };
}

test('Fixtures default to upcoming games and fold played games into "Earlier this season"', async () => {
  const { context, element } = loadApp([
    fixture('past-1', '2000-08-10T14:00:00Z'), fixture('past-2', '2000-08-17T14:00:00Z', { home: false }),
    fixture('next', '2099-08-20T19:00:00Z', { home: false, opponent: 'Next Rivals', venue: 'Away Park' }), fixture('later', '2099-08-27T14:00:00Z')
  ]);
  await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(vm.runInContext('activeFixtureFilter', context), 'upcoming');
  const html = element('#fixture-list').innerHTML;
  const [fold, upcoming] = html.split('</details>');
  assert.match(fold, /^<details class="earlier-fixtures"><summary><span>Earlier this season<\/span><small>2 played<\/small>/);
  assert.equal(fold.match(/<article class="fixture fixture-past/g).length, 2);
  assert.equal(upcoming.match(/<article class="fixture"/g).length, 2);
  assert.match(upcoming, /fixture-status">Next up/);
  assert.equal(element('#fixture-count').textContent, '2 games in this view');

  vm.runInContext("activeFixtureFilter = 'all'; render()", context);
  assert.doesNotMatch(element('#fixture-list').innerHTML, /earlier-fixtures/);
  assert.equal(element('#fixture-list').innerHTML.match(/<article class="fixture/g).length, 4);
});

test('The fold opens by itself when a season has no upcoming games left', async () => {
  const { context, element } = loadApp([fixture('past-1', '2000-08-10T14:00:00Z')]);
  await vm.runInContext('loadLiveFixtures()', context);
  assert.match(element('#fixture-list').innerHTML, /^<details class="earlier-fixtures" open>/);
  assert.equal(element('#next-up-opponent').textContent, 'No confirmed game yet');
  assert.equal(element('#next-up-add').disabled, true);
});

test('Next up card describes the next confirmed game and adds it to Google Calendar', async () => {
  const { context, element, opened } = loadApp([
    fixture('past-1', '2000-08-10T14:00:00Z'),
    fixture('tbd', '2099-08-18T12:00:00Z', { timeTbd: true, opponent: 'Unconfirmed FC' }),
    fixture('next', '2099-08-20T19:00:00Z', { home: false, opponent: 'Next Rivals', venue: 'Away Park', competition: 'FA Cup' })
  ]);
  await vm.runInContext('loadLiveFixtures()', context);
  assert.equal(element('#next-up-opponent').textContent, '@ Next Rivals');
  assert.equal(element('#next-up-competition').textContent, 'Away · FA Cup');
  assert.match(element('#next-up-when').textContent, /^Thu, Aug 20, 3:00 PM · Away Park$/);
  assert.match(element('#pulse-next').textContent, /^Next confirmed: Next Rivals/);
  assert.equal(element('#next-up-add').disabled, false);
  element('#next-up-add').listeners.click();
  assert.equal(opened.length > 0, true);
  assert.match(opened.at(-1), /calendar\.google\.com.*Next\+Rivals/);
});
