// The compass beam under the user's position (like Google Maps'): a fan that points
// where the phone points, wider while the compass is uncalibrated. A symbol layer with
// a pre-drawn image (scripts/maps/make-beam.py), rotated with `icon-rotate` in map
// alignment, so it keeps its screen size at every zoom and follows the map's bearing
// without re-rendering. Its own component: compass events re-render only this.
// The position comes from MapLibre's location manager, the engine that draws the
// native puck (the apex stays on the dot; expo-location's high accuracy request also
// fails on Android when Google's "Location Accuracy" is off). The map screen mounts it
// only while the Maps tab is in front (the compass costs battery).
import { GeoJSONSource, Images, Layer, LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/theme';

import { watchScreenHeading } from './heading';

const IMAGES = {
  'beam-narrow-light': require('../../../assets/maps/beam/beam-narrow-light.png'),
  'beam-narrow-dark': require('../../../assets/maps/beam/beam-narrow-dark.png'),
  'beam-wide-light': require('../../../assets/maps/beam/beam-wide-light.png'),
  'beam-wide-dark': require('../../../assets/maps/beam/beam-wide-dark.png'),
};

/** Compass events come many times a second: redraw when it turned this much. */
const MIN_TURN = 2;

type Fix = { lat: number; lon: number };
type Heading = { deg: number; wide: boolean };

export function HeadingBeam() {
  const { scheme } = useTheme();
  const [fix, setFix] = useState<Fix | null>(null);
  const [heading, setHeading] = useState<Heading | null>(null);

  useEffect(() => {
    const onFix = (p: GeolocationPosition) => setFix({ lat: p.coords.latitude, lon: p.coords.longitude });
    LocationManager.addListener(onFix);
    let alive = true;
    let sub: { remove: () => void } | null = null;
    // Turned to the screen: in landscape the user looks where the screen's top points.
    watchScreenHeading((h) => {
      // Which way the screen is turned isn't known yet: no beam rather than a wrong one.
      if (!h) {
        setHeading(null);
        return;
      }
      const { deg, accuracy } = h;
      // Calibration 3 (iOS: < 20° off) and 2 (< 35°): narrow; worse: wide.
      const wide = accuracy < 2;
      setHeading((prev) => {
        if (prev && prev.wide === wide && Math.abs(((deg - prev.deg + 540) % 360) - 180) < MIN_TURN) return prev;
        return { deg, wide };
      });
    })
      .then((s) => {
        if (alive) sub = s;
        else s.remove();
      })
      // No compass (some emulators): no beam, the native puck stays.
      .catch((e) => console.warn('[maps] heading beam', e));
    return () => {
      alive = false;
      LocationManager.removeListener(onFix);
      sub?.remove();
    };
  }, []);

  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features:
        fix && heading
          ? [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] },
                properties: { heading: heading.deg, image: `beam-${heading.wide ? 'wide' : 'narrow'}-${scheme}` },
              },
            ]
          : [],
    }),
    [fix, heading, scheme],
  );

  return (
    <>
      <Images images={IMAGES} />
      <GeoJSONSource id="heading-beam" data={data}>
        <Layer
          type="symbol"
          id="heading-beam"
          layout={{
            'icon-image': ['get', 'image'],
            'icon-anchor': 'bottom',
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
