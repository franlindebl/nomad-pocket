// When going over the posted limit warns (a soft double beep, the speed badge blinking): once the
// speed has stayed over it for a moment, not at every fix hovering around it. Warned once, it warns
// again after the user has been back under for a while, or when a lower limit starts while still
// over it. Speeds and limits come in the units the badge shows, so what turns red is what warns.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

/** Over the limit this long before warning (one fix over is GPS noise). */
const OVER_MS = 2000;
/** Back under the limit this long before the same limit warns again. */
const UNDER_MS = 5000;

export type SpeedWatch = {
  /** Since when over the limit (ms), null while under it. */
  overSince: number | null;
  /** Since when under it, null while over. */
  underSince: number | null;
  /** The limit of the last warning, null when the next excess may warn. */
  warned: number | null;
};

export const SPEED_WATCH: SpeedWatch = { overSince: null, underSince: null, warned: null };

/** Each fix: whether the speed is over the limit and whether this fix warns. No limit: never over. */
export function watchSpeed(w: SpeedWatch, speed: number, limit: number | null, now: number): { watch: SpeedWatch; over: boolean; warn: boolean } {
  const over = limit !== null && speed > limit;
  if (!over) {
    const underSince = w.underSince ?? now;
    return { watch: { overSince: null, underSince, warned: now - underSince >= UNDER_MS ? null : w.warned }, over, warn: false };
  }
  const overSince = w.overSince ?? now;
  const due = now - overSince >= OVER_MS && (w.warned === null || limit < w.warned);
  return { watch: { overSince, underSince: null, warned: due ? limit : w.warned }, over, warn: due };
}
