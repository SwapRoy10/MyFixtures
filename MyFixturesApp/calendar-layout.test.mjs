import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('My Week puts the seven-day slate before calendar subscription tools', () => {
  const page = read('./calendar.html');
  const orderedIds = ['week-title', 'week-strip', 'week-games', 'subscription-panel', 'health-details'];
  const positions = orderedIds.map((id) => page.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotMatch(page, /class="living-intro"/);
  assert.doesNotMatch(page, /Browse team schedules/);
});

test('Calendar setup keeps optional controls available without duplicating navigation', () => {
  const page = read('./calendar.html');
  const fixtures = read('./index.html');
  assert.match(page, /<details class="calendar-options"><summary>Calendar options<\/summary>/);
  assert.match(page, /<details class="subscription-guide"><summary/);
  for (const id of ['calendar-name', 'include-preseason', 'include-postseason', 'calendar-reminder', 'calendar-app', 'download-once']) {
    assert.equal(page.match(new RegExp(`id="${id}"`, 'g'))?.length, 1);
  }
  assert.doesNotMatch(fixtures, /My Week &amp; Living Calendar/);
  assert.match(fixtures, /<a href="\/calendar\.html">My Week<\/a>/);
});
