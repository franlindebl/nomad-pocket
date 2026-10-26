import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDuration, scaleBytes } from './units.ts';

const shown = (bytes: number, digits?: number) => {
  const { value, unit, fractionDigits } = scaleBytes(bytes, digits);
  return `${Number(value.toFixed(fractionDigits))} ${unit}`;
};

test('scaleBytes picks the unit after rounding', () => {
  assert.equal(shown(999.95e6), '1 GB');
  assert.equal(shown(999.4e6), '999 MB');
  assert.equal(shown(1.25e9), '1.3 GB');
  assert.equal(shown(127e9), '127 GB');
  assert.equal(shown(999.96e9), '1 TB');
  assert.equal(shown(5e14), '500 TB');
  assert.equal(shown(2e18), '2000000 TB'); // nothing above TB
  assert.equal(shown(500e3), '0.5 MB'); // never KB
  assert.equal(shown(999.9e6, 0), '1 GB');
  assert.equal(shown(12.34e6, 2), '12.34 MB');
});

test('formatDuration never shows 60 of a unit', () => {
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(Infinity), '—');
  assert.equal(formatDuration(1.2), '2 s');
  assert.equal(formatDuration(59.5), '1 min');
  assert.equal(formatDuration(61), '2 min');
  assert.equal(formatDuration(3541), '1 h');
  assert.equal(formatDuration(3600), '1 h');
  assert.equal(formatDuration(3601), '1 h 1 min');
  assert.equal(formatDuration(7170), '2 h');
  assert.equal(formatDuration(7199), '2 h');
  assert.equal(formatDuration(5400), '1 h 30 min');
});
