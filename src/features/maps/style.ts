// MapLibre style for local PMTiles: the Protomaps basemap layers, generated per
// source, with offline glyphs/sprites. The world basemap goes first and each
// regional extract is stacked on top with its own copy of the layers, so areas
// outside every region still show the low-zoom world map.
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import type { MapAssets } from './assets';

export type MapSourceInput = { id: string; fileUri: string };

const ATTRIBUTION = '© OpenStreetMap contributors · Protomaps';

/** `pmtiles://` + absolute file URL, the scheme MapLibre Native reads locally. */
export function pmtilesUrl(fileUri: string): string {
  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
  return `pmtiles://${uri}`;
}

export function buildMapStyle(opts: { scheme: 'light' | 'dark'; lang: string; assets: MapAssets; sources: MapSourceInput[] }): StyleSpecification {
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
      style.layers.push({ ...layer, id: `${s.id}:${layer.id}` } as (typeof style.layers)[number]);
    }
  }
  return style;
}
