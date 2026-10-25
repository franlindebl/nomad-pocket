// Navigation camera (Google Maps / Waze driving view): while following, every GPS fix
// eases the map to the user with the way ahead pointing up, tilted, and the user low on
// the screen (camera padding) so the road ahead shows above the guidance panel. Driven
// from JS with easeTo, not MapLibre's tracking modes: those ignore the padding on iOS
// (the user would sit under the panel) and turn the map by the raw GPS course rather
// than the route. Each ease lasts about as long as the gap between fixes, so the map
// glides instead of jumping, and the arrow is a plain view at the padded centre: it
// stays put while the map moves under it (the native puck would lag the camera).
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { Navigation2 } from 'lucide-react-native';
import { useEffect, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { FOLLOW_PITCH, followBearing, followZoom, turnBetween } from './follow-core';
import { useGuidance } from './guidance';

/** Compass updates come many times a second: turn the map when it moved this much. */
const MIN_TURN = 4;
/** Shortest and longest glide between two fixes, ms. */
const GLIDE_MIN = 400;
const GLIDE_MAX = 2500;
const ARROW = 44;

/** Moves the camera with the user while `active`; `top`/`bottom` padding put the user at the arrow. */
export function useFollowCamera(camera: RefObject<CameraRef | null>, active: boolean, top: number, bottom: number) {
  useEffect(() => {
    if (!active) return;
    let bearing: number | null = null;
    let fixAt = 0;
    let glideEnd = 0;
    let first = true;
    const move = (newFix: boolean) => {
      const s = useGuidance.getState();
      const p = s.position;
      if (!p) return;
      const b = followBearing({ costing: s.costing, course: p.course ?? null, heading: s.heading, progress: s.route ? s.progress : null, accuracy: p.accuracy });
      const now = Date.now();
      if (!newFix && (b === null || (bearing !== null && turnBetween(bearing, b) < MIN_TURN))) return;
      if (b !== null) bearing = b;
      let duration: number;
      if (first) duration = 900;
      else if (newFix) duration = Math.min(GLIDE_MAX, Math.max(GLIDE_MIN, now - fixAt));
      // A compass turn between fixes: finish the glide to the last fix, no faster than 300 ms.
      else duration = Math.max(300, glideEnd - now);
      if (newFix) fixAt = now;
      glideEnd = now + duration;
      camera.current?.easeTo({
        center: [p.lon, p.lat],
        zoom: followZoom(s.costing, p.speed ?? null),
        pitch: FOLLOW_PITCH,
        ...(bearing !== null ? { bearing } : {}),
        padding: { top, bottom, left: 0, right: 0 },
        duration,
        easing: first ? 'ease' : 'linear',
      });
      first = false;
    };
    move(true);
    return useGuidance.subscribe((s, prev) => {
      if (s.position !== prev.position) move(true);
      else if (s.heading !== prev.heading || s.progress !== prev.progress) move(false);
    });
  }, [camera, active, top, bottom]);
}

/** The user while following: an arrow pointing up (the map turns, not the arrow). */
export function FollowArrow({ x, y }: { x: number; y: number }) {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.arrow, { left: x - ARROW / 2, top: y - ARROW / 2, shadowColor: colors.shadow }]}>
      <Navigation2 size={ARROW} color={colors.onAccent} fill={colors.location} strokeWidth={1.6} />
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: { position: 'absolute', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
});
