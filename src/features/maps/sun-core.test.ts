import assert from 'node:assert/strict';
import test from 'node:test';

import { sunTimes } from './sun-core.ts';

/** Within `min` minutes of an ISO instant. */
function near(actual: number | null, iso: string, min = 3) {
  assert.ok(actual !== null, `expected ${iso}, got null`);
  const diff = Math.abs(actual - Date.parse(iso)) / 60000;
  assert.ok(diff <= min, `${new Date(actual).toISOString()} is ${diff.toFixed(1)} min from ${iso}`);
}

// Reference times: published almanac values (timeanddate.com / NOAA calculator), UTC.
test('sunrise, sunset and civil dusk', () => {
  const reykjavik = sunTimes(64.1466, -21.9426, new Date('2026-12-21T12:00Z'));
  near(reykjavik.sunrise, '2026-12-21T11:22Z');
  near(reykjavik.sunset, '2026-12-21T15:29Z');
  const nyc = sunTimes(40.7128, -74.006, new Date('2026-03-20T17:00Z'));
  near(nyc.sunrise, '2026-03-20T10:59Z');
  near(nyc.sunset, '2026-03-20T23:08Z');
  near(nyc.dusk, '2026-03-20T23:35Z');
  const sydney = sunTimes(-33.8688, 151.2093, new Date('2026-01-15T02:00Z'));
  near(sydney.sunrise, '2026-01-14T18:59Z');
  near(sydney.sunset, '2026-01-15T09:08Z');
  const madrid = sunTimes(40.4168, -3.7038, new Date('2026-06-21T12:00Z'));
  near(madrid.sunrise, '2026-06-21T04:44Z');
  near(madrid.sunset, '2026-06-21T19:48Z');
});

test('polar day and polar night', () => {
  const summer = sunTimes(69.6492, 18.9553, new Date('2026-06-21T12:00Z'));
  assert.equal(summer.sunrise, null);
  assert.equal(summer.sunset, null);
  const winter = sunTimes(69.6492, 18.9553, new Date('2026-12-21T12:00Z'));
  assert.equal(winter.sunset, null);
  // Civil twilight still comes at midday.
  assert.ok(winter.dusk !== null);
});
