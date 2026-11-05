// Sunrise, sunset and the end of civil twilight for a place and a day, offline: "¿llego antes de que anochezca?"
// and the lost card (docs/ASSISTANT_MAP_PLAN.md). NOAA's solar position equations (the ones of its online
// calculator), accurate to a minute or two away from the poles, which is plenty here.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export type SunTimes = {
  /** ms timestamps (UTC instants); null when the sun doesn't rise or set that day (polar day or night). */
  sunrise: number | null;
  sunset: number | null;
  /** Civil dusk: the sun 6° below the horizon, the end of usable light outdoors. */
  dusk: number | null;
  dawn: number | null;
};

const RAD = Math.PI / 180;

/** Julian century of a Julian day. */
const century = (jd: number) => (jd - 2451545) / 36525;

/** The sun's declination (degrees) and the equation of time (minutes) at a Julian century. */
function solar(t: number): { decl: number; eqTime: number } {
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C =
    Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    (4 *
      (y * Math.sin(2 * L0 * RAD) -
        2 * e * Math.sin(M * RAD) +
        4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
        0.5 * y * y * Math.sin(4 * L0 * RAD) -
        1.25 * e * e * Math.sin(2 * M * RAD))) /
    RAD;
  return { decl, eqTime };
}

/**
 * Minutes after UTC midnight when the sun crosses `zenith` degrees (90.833 rise/set, 96 civil twilight), rising or
 * setting; null when it never does that day. Iterated twice: the sun's position at the event's own time.
 */
function crossing(lat: number, lon: number, jd0: number, zenith: number, rising: boolean): number | null {
  let minutesUtc = 720 - 4 * lon;
  for (let i = 0; i < 2; i++) {
    const { decl, eqTime } = solar(century(jd0 + minutesUtc / 1440));
    const cosH = (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
    if (cosH > 1 || cosH < -1) return null;
    const ha = Math.acos(cosH) / RAD;
    minutesUtc = 720 - 4 * (lon + (rising ? ha : -ha)) - eqTime;
  }
  return minutesUtc;
}

/**
 * The sun's times on the calendar day `day` (its UTC date: pass noon of the local day, e.g. `new Date()` around
 * midday, or the date the person means). Times are instants; show them in the device's time zone.
 */
export function sunTimes(lat: number, lon: number, day: Date): SunTimes {
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const jd0 = midnight / 86400000 + 2440587.5;
  const at = (m: number | null) => (m === null ? null : Math.round(midnight + m * 60000));
  return {
    sunrise: at(crossing(lat, lon, jd0, 90.833, true)),
    sunset: at(crossing(lat, lon, jd0, 90.833, false)),
    dawn: at(crossing(lat, lon, jd0, 96, true)),
    dusk: at(crossing(lat, lon, jd0, 96, false)),
  };
}
