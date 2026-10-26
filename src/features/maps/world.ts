// The world basemap (z0–5, ~15 MB) ships inside the app (assets/maps/world.pmtiles, made by
// scripts/maps/make-world.sh), so there is a map from the first launch with nothing
// downloaded. It is copied once into content/maps (Android assets are not plain files) and
// registered as the 'world' item; a newer bundled build replaces an older copy.
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { getItem, upsertItem } from '@/features/content/items';
import i18n from '@/i18n';
import { contentFile } from '@/lib/storage';

import { mapItemId, WORLD_BBOX, WORLD_ID, WORLD_MAX_ZOOM, type MapItemMeta } from './extraction';

/** Protomaps build of the bundled file (YYYYMMDD): bump with the file. */
const BUNDLED_BUILD = '20261025';

let pending: Promise<void> | null = null;

export function ensureWorldMap(): Promise<void> {
  pending ??= install().catch((e) => {
    pending = null;
    console.warn('[maps] world map', e);
  });
  return pending;
}

async function install() {
  const id = mapItemId(WORLD_ID);
  const dest = contentFile('map', `${WORLD_ID}.pmtiles`);
  const current = getItem(id);
  if (current && dest.exists && (current.version ?? '') >= BUNDLED_BUILD) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a bundled asset (metro.config.js)
  const asset = Asset.fromModule(require('../../../assets/maps/world.pmtiles'));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('world map missing from bundle');
  const tmp = contentFile('map', `${WORLD_ID}.pmtiles.copy`);
  if (tmp.exists) tmp.delete();
  await new File(asset.localUri).copy(tmp);
  if (dest.exists) dest.delete();
  await tmp.move(dest);

  const meta: MapItemMeta = { role: 'world', bbox: WORLD_BBOX, minZoom: 0, maxZoom: WORLD_MAX_ZOOM, buildDate: BUNDLED_BUILD, regionId: null };
  upsertItem({
    id,
    kind: 'map',
    title: i18n.t('maps:download.titleWorld'),
    description: null,
    language: null,
    category: 'maps',
    isCourse: false,
    fileUri: dest.uri,
    sizeBytes: Number(dest.size ?? 0),
    version: BUNDLED_BUILD,
    sourceUrl: null,
    catalogId: null,
    meta,
  });
}
