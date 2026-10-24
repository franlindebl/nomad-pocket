// Maps feature wiring: startup init and item-removal hook.
import { File, FileMode } from 'expo-file-system';

import i18n from '@/i18n';
import { registerInit } from '@/features/bootstrap';
import { listItems, onItemRemoved, upsertItem } from '@/features/content/items';
import { HEADER_SIZE, parseHeader } from '@/lib/pmtiles/format';
import { contentDir, deleteFile, partialDir } from '@/lib/storage';

import { forgetEstimates, mapItemId, WORLD_ID, type MapItemMeta } from './extraction';
import { useMarkers } from './markers';
import { getRegion, regionName } from './regions';
import { resolveMapFile } from './useMapSources';

/** YYYYMMDD of a timestamp, the format map items keep their build date in. */
function yyyymmdd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Registers a .pmtiles file found in content/maps that no item points to (copied in via
 * Finder/Files, or seeded by the E2E suite). The file name is the key, as for downloads:
 * "es-ml.pmtiles" becomes the Melilla region, "world.pmtiles" the world basemap.
 */
function registerLooseMap(file: File) {
  const handle = file.open(FileMode.ReadOnly);
  let header;
  try {
    header = parseHeader(handle.readBytesSync(HEADER_SIZE));
  } finally {
    handle.close();
  }
  const key = file.name.replace(/\.pmtiles$/i, '');
  const region = getRegion(key);
  const info = file.info();
  const meta: MapItemMeta = {
    role: key === WORLD_ID ? 'world' : 'region',
    bbox: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    buildDate: yyyymmdd(info.modificationTime ?? Date.now()),
    regionId: region?.id ?? null,
  };
  const title = key === WORLD_ID ? i18n.t('maps:download.titleWorld') : region ? regionName(region, i18n.language) : key;
  upsertItem({
    id: mapItemId(key),
    kind: 'map',
    title,
    description: null,
    language: null,
    category: 'maps',
    isCourse: false,
    fileUri: file.uri,
    sizeBytes: Number(info.size ?? 0),
    version: meta.buildDate,
    sourceUrl: null,
    catalogId: region?.id ?? null,
    meta,
  });
}

registerInit(() => {
  useMarkers.getState().refresh();
  // Extraction jobs live in memory; a relaunch leaves their partial files behind.
  for (const entry of partialDir().list()) {
    if (entry.name.startsWith('map-') && entry.name.endsWith('.pmtiles.part')) {
      try {
        entry.delete();
      } catch {
        // in use or gone
      }
    }
  }
  // Items store absolute URIs that go stale when iOS moves the container: compare names.
  const known = new Set(listItems('map').map((i) => decodeURIComponent(i.fileUri.split('/').pop() ?? '')));
  for (const entry of contentDir('map').list()) {
    if (!(entry instanceof File) || !/\.pmtiles$/i.test(entry.name) || known.has(entry.name)) continue;
    try {
      registerLooseMap(entry);
    } catch (e) {
      console.warn('[maps] cannot register', entry.name, e);
    }
  }
});

// The map screen drops the source from its style as soon as the items list
// refreshes. removeItem deletes the stored path, which is stale after iOS moves
// the data container, so also delete the file where it lives now.
onItemRemoved('map', (item) => {
  forgetEstimates();
  deleteFile(resolveMapFile(item));
});
