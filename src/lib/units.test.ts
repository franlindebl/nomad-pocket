import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDuration, type MeasurementSystem, scaleBytes, scaleDistance, scaleWater } from './units.ts';

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

const dist = (meters: number, system: MeasurementSystem, step?: number) => {
  const { value, unit, fractionDigits } = scaleDistance(meters, system, step);
  return `${Number(value.toFixed(fractionDigits))} ${unit}`;
};

test('scaleDistance in metric', () => {
  assert.equal(dist(3, 'metric'), '10 m');
  assert.equal(dist(847, 'metric'), '850 m');
  assert.equal(dist(996, 'metric'), '1 km'); // not "1000 m"
  assert.equal(dist(3140, 'metric'), '3.1 km');
  assert.equal(dist(9960, 'metric'), '10 km');
  assert.equal(dist(35_400, 'metric'), '35 km');
  assert.equal(dist(7, 'metric', 1), '7 m');
});

test('scaleDistance in the US: feet, then miles from 0.1 mi', () => {
  assert.equal(dist(2, 'us'), '10 ft');
  assert.equal(dist(61, 'us'), '200 ft');
  assert.equal(dist(150, 'us'), '490 ft');
  assert.equal(dist(160, 'us'), '0.1 mi');
  assert.equal(dist(3140, 'us'), '2 mi');
  assert.equal(dist(5000, 'us'), '3.1 mi');
  assert.equal(dist(56_000, 'us'), '35 mi');
  assert.equal(dist(7, 'us', 1), '23 ft');
});

test('scaleDistance in the UK: yards, then miles', () => {
  assert.equal(dist(100, 'uk'), '110 yd');
  assert.equal(dist(1609, 'uk'), '1 mi');
});

test('scaleWater: gallons only in the US', () => {
  const water = (liters: number, system: MeasurementSystem) => {
    const { value, unit, fractionDigits } = scaleWater(liters, system);
    return `${Number(value.toFixed(fractionDigits))} ${unit}`;
  };
  assert.equal(water(12, 'metric'), '12 L');
  assert.equal(water(12, 'uk'), '12 L');
  assert.equal(water(12, 'us'), '3.2 gal');
  assert.equal(water(84, 'us'), '22 gal');
});
