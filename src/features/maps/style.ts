// MapLibre style for local PMTiles: the Protomaps basemap layers, generated per
// source, with offline glyphs/sprites. The world basemap goes first and each
// regional extract is stacked on top with its own copy of the layers, so areas
// outside every region still show the low-zoom world map.
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import type { MapAssets } from './assets';
import { EMERGENCY_KINDS } from './emergency-core';

export type MapSourceInput = { id: string; fileUri: string };

const ATTRIBUTION = '© OpenStreetMap contributors · Protomaps';

type Layer = StyleSpecification['layers'][number];
type LegacyFilter = unknown[];

/** Half the Protomaps width: a driveway or a parking aisle doesn't read as a street. */
const SERVICE_WIDTH = ['interpolate', ['exponential', 1.6], ['zoom'], 13, 0, 18, 4];

/**
 * Protomaps draws every highway=service almost like a street, private and underground
 * ones included (a garage under a Madrid block showed as a street through the building).
 * The tiles carry `access` and `is_tunnel` but not the service type: hide private and
 * underground service roads, draw the rest narrower. Filters stay in the legacy syntax
 * the basemap uses (MapLibre rejects mixing it with expressions).
 */
function tameServiceRoads(layer: Layer, id: string): Layer {
  const filter = ('filter' in layer ? layer.filter : undefined) as LegacyFilter | undefined;
  if (!filter || filter[0] !== 'all') return layer;
  if (id === 'roads_minor_service' || id === 'roads_minor_service_casing') {
    const paint = { ...(layer.paint as object), [id.endsWith('_casing') ? 'line-gap-width' : 'line-width']: SERVICE_WIDTH };
    return { ...layer, filter: [...filter, ['!in', 'access', 'private', 'no']], paint } as unknown as Layer;
  }
  if (id === 'roads_tunnels_minor' || id === 'roads_tunnels_minor_casing') {
    return { ...layer, filter: [...filter, ['!=', 'kind_detail', 'service']] } as unknown as Layer;
  }
  return layer;
}

/**
 * The emergency points draw supermarkets, fountains and town halls themselves. Protomaps
 * draws them too, as a framed icon with its label in the category colour, at the same
 * spot: our dot sat inside its frame, and label collisions picked our grey name or its
 * coloured one depending on the zoom. One mark per place: the basemap skips our kinds.
 * (Its POI filter is an expression, unlike the road layers' legacy ones.)
 */
function skipOurPois(layer: Layer, id: string): Layer {
  const filter = ('filter' in layer ? layer.filter : undefined) as unknown[] | undefined;
  if (id !== 'pois' || !filter || filter[0] !== 'all') return layer;
  const ours = ['!', ['in', ['get', 'kind'], ['literal', Object.keys(EMERGENCY_KINDS)]]];
  return { ...layer, filter: [...filter, ours] } as unknown as Layer;
}

/** `pmtiles://` + absolute file URL, the scheme MapLibre Native reads locally. */
export function pmtilesUrl(fileUri: string): string {
  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
  return `pmtiles://${uri}`;
}

export function buildMapStyle(opts: {
  scheme: 'light' | 'dark';
  lang: string;
  assets: MapAssets;
  sources: MapSourceInput[];
}): StyleSpecification {
  const flavor = namedFlavor(opts.scheme);
  const style: StyleSpecification = {
    version: 8,
    glyphs: opts.assets.glyphs,
    sprite: opts.assets.sprite(opts.scheme),
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': flavor.background } }],
  };
  for (const s of opts.sources) {
    style.sources[s.id] = { type: 'vector', url: pmtilesUrl(s.fileUri), attribution: ATTRIBUTION };
    for (const layer of layers(s.id, flavor, { lang: opts.lang })) {
      if (layer.type === 'background') continue;
      style.layers.push({ ...skipOurPois(tameServiceRoads(layer as Layer, layer.id), layer.id), id: `${s.id}:${layer.id}` } as Layer);
    }
  }
  return style;
}
