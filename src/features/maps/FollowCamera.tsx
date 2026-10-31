// Navigation camera (Google Maps / Waze driving view): while following, every GPS fix
// eases the map to the user with the way they go pointing up (or north up, the user's
// choice), tilted, and the user low on the screen (camera padding) so the road ahead
// shows above the guidance panel. Driven from JS with easeTo, not MapLibre's tracking
// modes: those ignore the padding on iOS (the user would sit under the panel) and turn
// the map by the raw GPS course. The user sits on the route (snapped), and each ease
// goes to where they will be at the next fix and lasts a little longer, so the map glides
// on instead of stopping at every fix one fix behind (follow-core). The arrow is a plain
// view at the padded centre: it stays put while the map moves under it (the native puck
// would lag the camera).
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { Navigation2 } from 'lucide-react-native';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { followBearing, followCenter, followPitch, followZoom, isWeakFix, movingBearing, smoothTurn } from './follow-core';
import { useGuidance } from './guidance';

/** Shortest and longest glide between two fixes, ms. */
const GLIDE_MIN = 400;
const GLIDE_MAX = 2500;
/**
 * Each glide is planned this much longer than the expected gap (and aims as far ahead): a fix
 * that comes late finds the map still moving at the user's pace instead of stopped, and the next
 * one takes over mid-glide.
 */
const GLIDE_OVERRUN = 1.3;
/**
 * The move that starts following ("Iniciar", "Recentrar"): one ease straight to the user, and fixes
 * that come meanwhile wait for it. Each used to start another ease from wherever the first had got
 * to, with another bearing and zoom: the map wandered on the way, the arrow already drawn at the
 * centre over places the user wasn't.
 */
const SETTLE_MS = 1000;
const ARROW = 44;
/** The compass beam's image (scripts/maps/make-beam.py), its apex at the bottom centre. */
const BEAM = { width: 80, height: 88 };
const BEAMS = {
  light: require('../../../assets/maps/beam/beam-narrow-light.png'),
  dark: require('../../../assets/maps/beam/beam-narrow-dark.png'),
};

/**
 * Moves the camera with the user while `active`; `top`/`bottom` padding put the user at
 * the arrow. onBearing gets the direction of travel the camera uses (for a north-up arrow).
 * Returns whether the camera has arrived at the user: until then the screen shows the map's own
 * location dot, not the arrow.
 */
export function useFollowCamera(
  camera: RefObject<CameraRef | null>,
  active: boolean,
  top: number,
  bottom: number,
  northUp: boolean,
  onBearing: (bearing: number | null) => void,
) {
  const report = useRef(onBearing);
  // Read at each fix: a banner turning two lines high must not restart the glide.
  const padding = useRef({ top, bottom });
  useEffect(() => {
    report.current = onBearing;
    padding.current = { top, bottom };
  }, [onBearing, top, bottom]);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // Stopping (the cleanup below) sets settled back to false.
    if (!active) return;
    let bearing: number | null = null;
    /** Until when the first move runs; fixes before then wait for it. */
    let settling = 0;
    let wait: ReturnType<typeof setTimeout> | null = null;
    let fixAt = 0;
    /** Expected time between fixes, smoothed (iOS gives ~1 s driving, a fix every few metres walking). */
    let gap = 1000;
    let first = true;
    const move = () => {
      const s = useGuidance.getState();
      const p = s.position;
      if (!p) return;
      const now = Date.now();
      // The end of the first move takes the latest fix.
      if (now < settling) return;
      const since = now - fixAt;
      if (!first) gap = 0.7 * gap + 0.3 * Math.min(GLIDE_MAX, Math.max(GLIDE_MIN, since));
      const progress = s.route ? s.progress : null;
      const moving = movingBearing(s.costing, p.course ?? null, p.travel ?? null);
      // Standing off the route keeps the map; the compass only sets the very first bearing on foot.
      const next = followBearing({ moving, progress, accuracy: p.accuracy }) ?? (bearing === null && s.costing !== 'auto' ? s.heading : null);
      if (next !== null) bearing = bearing === null ? next : smoothTurn(bearing, next, first ? 0 : since, s.costing);
      const duration = first ? SETTLE_MS : gap * GLIDE_OVERRUN;
      fixAt = now;
      const center = followCenter({ position: p, route: s.route, cumulative: s.routeCumulative, progress, moving, gapMs: duration });
      camera.current?.easeTo({
        center: [center.lon, center.lat],
        zoom: followZoom(s.costing, p.speed ?? null, progress?.toNextM ?? null),
        pitch: followPitch(s.costing),
        ...(northUp ? { bearing: 0 } : bearing !== null ? { bearing } : {}),
        padding: { ...padding.current, left: 0, right: 0 },
        duration,
        easing: first ? 'ease' : 'linear',
      });
      report.current(bearing);
      if (first) {
        settling = now + SETTLE_MS;
        wait = setTimeout(() => {
          wait = null;
          setSettled(true);
          move();
        }, SETTLE_MS);
      }
      first = false;
    };
    move();
    const unsubscribe = useGuidance.subscribe((s, prev) => {
      if (s.position !== prev.position) move();
    });
    return () => {
      unsubscribe();
      if (wait) clearTimeout(wait);
      setSettled(false);
    };
  }, [camera, active, northUp]);
  return active && settled;
}

/** A rotation style that eases the short way round (350° → 10° turns 20°, not back 340°). */
function useTurning(deg: number) {
  const angle = useSharedValue(deg);
  useEffect(() => {
    const delta = ((deg - angle.value + 540) % 360) - 180;
    angle.value = withTiming(angle.value + delta, { duration: 300, easing: Easing.out(Easing.quad) });
  }, [deg, angle]);
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
}

/**
 * The user while following: an arrow pointing the way they go (up when the map turns
 * with them; turned when the map is north up), grey when the GPS fix is old or rough.
 */
export function FollowArrow({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  const { colors } = useTheme();
  const weak = useWeakFix();
  const turning = useTurning(rotation);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.arrow, { left: x - ARROW / 2, top: y - ARROW / 2, shadowColor: colors.shadow }, turning]}>
      <Navigation2 size={ARROW} color={colors.onAccent} fill={weak ? colors.textTertiary : colors.location} strokeWidth={1.6} />
    </Animated.View>
  );
}

/** A rough fix, or none lately while moving: re-checked every couple of seconds (no fix comes to say so). */
function useWeakFix() {
  const check = () => {
    const p = useGuidance.getState().position;
    return !p || isWeakFix(p.at, p.accuracy, p.speed ?? null, Date.now());
  };
  const [weak, setWeak] = useState(check);
  useEffect(() => {
    const timer = setInterval(() => setWeak(check()), 2000);
    const unsubscribe = useGuidance.subscribe((s, prev) => {
      if (s.position !== prev.position) setWeak(check());
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return weak;
}

/**
 * On foot or by bike, the compass beam under the arrow: where the phone points, while the
 * map keeps the way the user goes. A view, not the map's beam layer, so its apex stays on
 * the arrow while the camera glides.
 */
export function FollowBeam({ x, y, mapBearing }: { x: number; y: number; mapBearing: number }) {
  const { scheme } = useTheme();
  const heading = useGuidance((s) => s.heading);
  const costing = useGuidance((s) => s.costing);
  const turning = useTurning(heading === null ? 0 : heading - mapBearing);
  if (heading === null || costing === 'auto') return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.beam, { left: x - BEAM.width / 2, top: y - BEAM.height }, turning]}>
      <Image source={BEAMS[scheme]} style={BEAM} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  arrow: { position: 'absolute', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  beam: { position: 'absolute', transformOrigin: '50% 100%' },
});
