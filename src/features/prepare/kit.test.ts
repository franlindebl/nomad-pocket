import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addMonths, expiryStatus, formatMonth, isMonth, KIT, kitFor, monthOf, monthsUntil, planReminders, reminderDate, supplies } from './kit.ts';

test('supplies scale with people, pets and days', () => {
  const s = supplies({ adults: 2, children: 1, pets: 1, days: 3 });
  assert.equal(s.people, 3);
  assert.equal(s.waterLiters, (3 * 4 + 1) * 3);
  assert.equal(s.foodKcal, (2 * 2000 + 1400) * 3);
  assert.equal(s.medicationDays, 30);
  assert.equal(supplies({ adults: 1, children: 0, pets: 0, days: 14 }).waterLiters, 56);
});

test('children and pet items only when they apply', () => {
  const ids = (h: Parameters<typeof kitFor>[0]) => new Set(kitFor(h).map((i) => i.id));
  const base = ids({ adults: 1, children: 0, pets: 0, days: 3 });
  assert.ok(!base.has('kidsFood') && !base.has('petSupplies'));
  assert.ok(ids({ adults: 1, children: 2, pets: 0, days: 3 }).has('kidsFood'));
  assert.ok(ids({ adults: 1, children: 0, pets: 1, days: 3 }).has('petSupplies'));
});

test('kit ids are unique', () => {
  assert.equal(new Set(KIT.map((i) => i.id)).size, KIT.length);
});

test('month arithmetic crosses years', () => {
  assert.equal(monthOf(new Date(2026, 9, 25)), '2026-10');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(monthsUntil('2027-10', new Date(2026, 9, 1)), 12);
  assert.ok(isMonth('2026-12') && !isMonth('2026-13') && !isMonth('26-01') && !isMonth(null));
});

test('expiry status: this or next month is soon, earlier is expired', () => {
  const now = new Date(2026, 9, 25);
  assert.equal(expiryStatus('2026-09', now), 'expired');
  assert.equal(expiryStatus('2026-10', now), 'soon');
  assert.equal(expiryStatus('2026-11', now), 'soon');
  assert.equal(expiryStatus('2026-12', now), 'ok');
});

test('reminder a month ahead, never in the past', () => {
  const now = new Date(2026, 9, 25);
  const at = reminderDate('2027-03', now);
  assert.ok(at);
  assert.deepEqual([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()], [2027, 1, 1, 10]);
  assert.equal(reminderDate('2027-01', now)?.getMonth(), 11);
  assert.equal(reminderDate('2026-11', now), null);
});

test('formatMonth is localized', () => {
  assert.match(formatMonth('2027-06', 'es'), /junio/);
  assert.match(formatMonth('2027-06', 'en'), /June 2027/);
});

test('planReminders schedules what is missing and cancels the rest', () => {
  const now = new Date(2026, 9, 25);
  const entries = {
    water: { expires: '2027-06', reminderId: 'n-water' },
    food: { expires: '2027-03', reminderId: null }, // permission granted later, or a restored backup
    batteries: { expires: '2027-01', reminderId: 'n-lost' }, // stored id the OS no longer holds
    firstAid: { expires: '2026-11', reminderId: 'n-past' }, // the reminder moment has passed
    kidsFood: { expires: '2027-05', reminderId: 'n-kids' }, // no children any more
    candles: { expires: null, reminderId: null },
  };
  const inKit = new Set(['water', 'food', 'batteries', 'firstAid', 'candles']);
  const scheduled = [
    { id: 'n-water', itemId: 'water', lang: 'es' },
    { id: 'n-kids', itemId: 'kidsFood', lang: 'es' },
    { id: 'n-stray', itemId: 'water', lang: 'es' },
    { id: 'n-old', itemId: null, lang: null },
  ];
  const plan = planReminders(entries, inKit, scheduled, now, 'es');
  assert.deepEqual(plan.cancel.sort(), ['n-kids', 'n-old', 'n-stray']);
  assert.deepEqual(plan.schedule.sort(), ['batteries', 'food']);
  assert.deepEqual(plan.clear.sort(), ['firstAid', 'kidsFood']);
});

test('planReminders rewrites reminders scheduled in another language', () => {
  const now = new Date(2026, 9, 25);
  const entries = { water: { expires: '2027-06', reminderId: 'n-water' } };
  const inKit = new Set(['water']);
  assert.deepEqual(planReminders(entries, inKit, [{ id: 'n-water', itemId: 'water', lang: 'es' }], now, 'en'), {
    cancel: ['n-water'],
    schedule: ['water'],
    clear: [],
  });
  assert.deepEqual(planReminders(entries, inKit, [{ id: 'n-water', itemId: 'water', lang: 'en' }], now, 'en'), {
    cancel: [],
    schedule: [],
    clear: [],
  });
});
