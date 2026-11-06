// Navigation camera (Google Maps / Waze driving view): while following, every GPS fix
// eases the map to the user with the way they go pointing up (or north up, the user's
// choice), tilted, and the user low on the screen (camera padding) so the road ahead
// shows above the guidance panel. Driven from JS with easeTo, not MapLibre's tracking
// modes: those ignore the padding on iOS (the user would sit under the panel) and turn
// the map by the raw GPS course. The user sits on the route (snapped), and each ease
// goes to where they will be at the next fix and lasts a little longer, so the map glides
// on instead of stopping at every fix one fix behind (follow-core). The arrow is a plain
// view at the padded centre: it stays put while the map moves under it (the native puck
// would lag the camera). In the background it sends nothing: nobody sees the map, and background
// location would otherwise keep easing it at every fix.
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { Navigation2 } from 'lucide-react-native';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, Image, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { createFollower, isWeakFix, SETTLE_MS } from './follow-core';
import { useGuidance } from './guidance';

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
    const follower = createFollower();
    /** Until when the first move runs; fixes before then wait for it. */
    let settling = 0;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const move = () => {
      const now = Date.now();
      // The end of the first move takes the latest fix (one ease straight to the user: each fix used to
      // start another from wherever the first had got to, and the map wandered on the way).
      if (now < settling) return;
      if (AppState.currentState !== 'active') return;
      const frame = follower.next(useGuidance.getState(), now);
      if (!frame) return;
      camera.current?.easeTo({
        center: [frame.center.lon, frame.center.lat],
        zoom: frame.zoom,
        pitch: frame.pitch,
        ...(northUp ? { bearing: 0 } : frame.bearing !== null ? { bearing: frame.bearing } : {}),
        padding: { ...padding.current, left: 0, right: 0 },
        duration: frame.duration,
        easing: frame.first ? 'ease' : 'linear',
      });
      report.current(frame.bearing);
      if (frame.first) {
        settling = now + SETTLE_MS;
        wait = setTimeout(() => {
          wait = null;
          setSettled(true);
          move();
        }, SETTLE_MS);
      }
    };
    move();
    const unsubscribe = useGuidance.subscribe((s, prev) => {
      if (s.position !== prev.position) move();
    });
    // Back in the foreground: catch up with the user at once instead of at the next fix.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') move();
    });
    return () => {
      unsubscribe();
      appState.remove();
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
