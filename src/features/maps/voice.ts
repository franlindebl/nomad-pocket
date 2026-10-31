// Spoken prompts while navigating: voice-core's cues for the route being followed, said with the
// system's offline voices (modules/nomad-voice), on the phone or through the car. They start with
// "Iniciar" (the navigation view), keep going with the screen locked (guidance watches the GPS in
// the background), and stop with the trip. The speaker button mutes them (setting navVoice). A reroute
// that sends the user another way chimes first, like Google Maps' and Waze's (muted with the voice).
import i18n from '@/i18n';
import { measurementSystem } from '@/lib/format';
import { useSettings } from '@/stores/settings';

import NomadVoice from '../../../modules/nomad-voice';
import { useGuidance } from './guidance';
import type { Route } from './routing-core';
import { isNewWay, keysOf, lowerFirst, nextCue, spokenDistance, START_KEY } from './voice-core';

/** Cues already said for `routeSeen`. */
let spoken = new Set<string>();
let routeSeen: Route | null = null;
let watching = false;
/** When the reroute chime last played: a prompt right after it waits for it to end. */
let chimedAt = 0;
const CHIME_MS = 400;

const voiceLanguage = () => (i18n.language === 'es' ? 'es-ES' : 'en-US');

function say(text: string) {
  const wait = chimedAt + CHIME_MS - Date.now();
  if (wait > 0) {
    setTimeout(() => say(text), wait);
    return;
  }
  NomadVoice.speak(text, voiceLanguage()).catch((e) => console.warn('[maps] voice', e));
}

function distanceWords(meters: number): string {
  const { value, unit } = spokenDistance(meters, measurementSystem());
  return i18n.t(`maps:voice.unit.${unit}`, { count: value, value: new Intl.NumberFormat(i18n.language).format(value) });
}

/** Started once by the maps init. */
export function watchVoice() {
  if (watching) return;
  watching = true;
  useGuidance.subscribe((s, prev) => {
    if (!s.navigating) {
      if (prev.navigating) {
        NomadVoice.stop().catch(() => {});
        spoken = new Set();
        routeSeen = null;
      }
      return;
    }
    if (!s.route || s.routing !== 'ready' || !s.progress) return;
    if (s.route !== routeSeen) {
      // A reroute mid-trip: no "head north on…" again, only what comes next; a chime when it changes the way.
      if (routeSeen && useSettings.getState().navVoice && isNewWay(routeSeen.shape, s.route.shape)) {
        chimedAt = Date.now();
        NomadVoice.chime().catch((e) => console.warn('[maps] chime', e));
      }
      spoken = routeSeen ? new Set([START_KEY]) : new Set();
      routeSeen = s.route;
    }
    if (!useSettings.getState().navVoice) return;
    const cue = nextCue({
      maneuvers: s.route.maneuvers,
      next: s.progress.next,
      toNextM: s.progress.toNextM,
      offRouteM: s.progress.offRouteM,
      costing: s.route.costing,
      speedMps: s.position?.speed ?? null,
      spoken,
    });
    if (!cue) return;
    for (const k of keysOf(cue)) spoken.add(k);
    say(cue.kind === 'early' ? i18n.t('maps:voice.in', { distance: distanceWords(cue.distanceM ?? 0), instruction: lowerFirst(cue.text) }) : cue.text);
  });
  // Muted mid-prompt: silence now.
  useSettings.subscribe((s, prev) => {
    if (prev.navVoice && !s.navVoice) NomadVoice.stop().catch(() => {});
  });
}
