// What a tap on the base map picks: the restaurant, bus stop or town label under the finger
// (rendered features of the basemap's pois and places layers) and the street it stands on (the
// nearest named road line drawn around it), for the place card. Pure, no @/ imports, so
// node --test runs it.
import { distanceMeters, type LatLon } from './geo.ts';
import { localizedName, packNames } from './places-core.ts';

/** What queryRenderedFeatures returns, as far as this file reads it. */
export type TapFeature = {
  geometry: { type: string; coordinates: unknown };
  properties?: Record<string, unknown> | null;
};

export type TappedPlace = {
  /** In the app's language when the map has it; '' for an unnamed point (the card shows its kind). */
  name: string;
  nativeName: string | null;
  kind: string;
  layer: 'poi' | 'place';
  lat: number;
  lon: number;
};

export type Street = { name: string; native: string };

/** A road drawn this far from the place is its street; beyond, it isn't on it. */
export const STREET_MAX_M = 60;

const str = (props: Record<string, unknown>, k: string) => (typeof props[k] === 'string' ? (props[k] as string).trim() : '');

function names(props: Record<string, unknown>, lang: string): { name: string; native: string | null } {
  const name = str(props, 'name');
  if (!name) return { name: '', native: null };
  return localizedName({ name, names: packNames(name, str(props, 'name:es'), str(props, 'name:en')) }, lang);
}

/**
 * The point nearest the tap among the rendered features of the basemap's POI and place
 * (town, neighbourhood) layers, queried apart: rendered features don't say their layer.
 */
export function tappedPlace(found: { poi: TapFeature[]; place: TapFeature[] }, at: LatLon, lang: string): TappedPlace | null {
  let best: TappedPlace | null = null;
  let bestD = Infinity;
  for (const layer of ['poi', 'place'] as const) {
    for (const f of found[layer]) {
      if (f.geometry.type !== 'Point') continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const props = f.properties ?? {};
      const kind = layer === 'place' ? str(props, 'kind_detail') || str(props, 'kind') || 'place' : str(props, 'kind');
      const n = names(props, lang);
      // A town label always has a name; a POI without one still has its kind ("Restaurante").
      if (!kind || (layer === 'place' && !n.name)) continue;
      const d = distanceMeters(at, { lat, lon });
      if (d >= bestD) continue;
      bestD = d;
      best = { name: n.name, nativeName: n.native, kind, layer, lat, lon };
    }
  }
  return best;
}

/** Metres from `p` to the segment a–b, on a local flat projection (fine over a street's length). */
function toSegment(p: LatLon, a: [number, number], b: [number, number]): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a[0] - p.lon) * k;
  const ay = a[1] - p.lat;
  const bx = (b[0] - p.lon) * k;
  const by = b[1] - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 111_320;
}

function lines(g: TapFeature['geometry']): [number, number][][] {
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
}

/** The named road line nearest `p`, within STREET_MAX_M. `native` is its OpenStreetMap name (the address index keys it). */
export function nearestStreet(features: TapFeature[], p: LatLon, lang: string): Street | null {
  let best: Street | null = null;
  let bestD = STREET_MAX_M;
  for (const f of features) {
    const props = f.properties ?? {};
    const native = str(props, 'name');
    const kind = str(props, 'kind');
    if (!native || kind === 'rail' || kind === 'ferry' || kind === 'aerialway') continue;
    for (const line of lines(f.geometry)) {
      for (let i = 1; i < line.length; i++) {
        const d = toSegment(p, line[i - 1], line[i]);
        if (d >= bestD) continue;
        bestD = d;
        best = { name: names(props, lang).name, native };
      }
    }
  }
  return best;
}
