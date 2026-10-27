// Maps feature wiring: startup init, item-removal hooks (maps, routing packs), and the search index /
// emergency points that follow every installed map.
import { File, FileMode } from 'expo-file-system';
import * as Location from 'expo-location';

import i18n from '@/i18n';
import { registerInit } from '@/features/bootstrap';
import { registerCompletionHandler } from '@/features/downloads/manager';
import { getItem, listItems, onItemRemoved, upsertItem } from '@/features/content/items';
import { HEADER_SIZE, parseHeader } from '@/lib/pmtiles/format';
import { contentDir, deleteFile, partialDir } from '@/lib/storage';

import { routePacksFor } from './country-core';
import { onMapFileDownloaded, refreshMapsCatalog, resumeMapImports, sweepCountryMapFiles, useMapsCatalog } from './country-maps';
import { cancelEmergencySync, syncEmergencyPoints } from './emergency';
import { forgetEstimates, mapItemId, onMapInstalled, WORLD_ID, type MapItemMeta } from './extraction';
import { useMarkers } from './markers';
import { forgetMapSource, indexDetailAround, indexDetailAroundView, indexStaleMaps, invalidateIndex } from './places';
import { getRegion, regionName } from './regions';
import { closeRouter, listRoutePacks, registerLoosePack, resolvePackFile } from './routing';
import { onRouteFileDownloaded, refreshRoutingCatalog, resumePackImports, sweepRoutingFiles, useRoutingCatalog } from './routing-packs';
import { forgetSideFilesOf } from './side-files';
import { resolveMapFile, type MapItem } from './useMapSources';
import { ensureWorldMap } from './world';

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
  // Routing packs copied in by hand or seeded by the E2E suite.
  const packs = new Set(listRoutePacks().map((i) => decodeURIComponent(i.fileUri.split('/').pop() ?? '')));
  for (const entry of contentDir('route').list()) {
    if (!(entry instanceof File) || !/\.tar$/i.test(entry.name) || packs.has(entry.name)) continue;
    try {
      registerLoosePack(entry, yyyymmdd(entry.info().modificationTime ?? Date.now()));
    } catch (e) {
      console.warn('[maps] cannot register routing pack', entry.name, e);
    }
  }
  // The bundled world basemap: always there, even with nothing downloaded.
  ensureWorldMap();
  // Index maps installed before search existed, or whose indexing was interrupted.
  // Delayed so the first screens render before the JS thread starts decoding tiles.
  setTimeout(() => {
    try {
      indexStaleMaps();
    } catch (e) {
      console.warn('[maps] cannot schedule indexing', e);
    }
    indexDetailAroundUser();
    // By now the download manager has restored its queue (what is still in flight).
    try {
      sweepRoutingFiles();
      sweepCountryMapFiles();
      // Imports a kill cut short: their files are still on disk.
      resumePackImports();
      resumeMapImports();
    } catch (e) {
      console.warn('[maps] cannot sweep routing files', e);
    }
    // Both catalogs make up a country download (and installed packs pick up street names).
    refreshRoutingCatalog();
    refreshMapsCatalog();
  }, 4000);
});

/**
 * The map detail around the user (where they are, else where the map was left), so search
 * finds nearby schools and shops on a big map. Never asks for permission, nor (Android) to
 * turn on Google's location accuracy. A fresh install has no last known position yet: then
 * one coarse fix.
 */
function indexDetailAroundUser() {
  Location.getForegroundPermissionsAsync()
    .then(async (p) => {
      if (!p.granted) return null;
      return (
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, mayShowUserSettingsDialog: false }))
      );
    })
    .catch(() => null)
    .then((pos) => {
      if (pos) indexDetailAround({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      else indexDetailAroundView();
    })
    .catch((e) => console.warn('[maps] cannot index the detail around the user', e));
}

/** Whether the catalogs give a map's country search files with every named place (its own, or a routing pack's). */
function bringsSearchFiles(item: MapItem): boolean {
  if (useMapsCatalog.getState().manifest?.maps.some((m) => mapItemId(m.id) === item.id && !!m.places)) return true;
  const region = item.meta.regionId;
  return !!region && routePacksFor(useRoutingCatalog.getState().manifest?.packs ?? [], region).some((p) => !!p.places);
}

onMapInstalled((id) => {
  let item = getItem(id) as MapItem | null;
  if (!item) return;
  // Said before indexing it: a map whose country brings search files is indexed lighter (places.ts).
  const bundledSearch = item.meta.role === 'region' && bringsSearchFiles(item);
  if (!!item.meta.bundledSearch !== bundledSearch) {
    item = { ...item, meta: { ...item.meta, bundledSearch } };
    upsertItem(item);
  }
  invalidateIndex(item);
  indexDetailAroundUser();
  // The new region's emergency points (needs the connection the download just used),
  // unless they came with it (country map or routing pack).
  if (!item.meta.bundledPoints) syncEmergencyPoints(item).catch((e) => console.warn('[maps] emergency points', e));
});

// The map screen drops the source from its style as soon as the items list
// refreshes. removeItem deletes the stored path, which is stale after iOS moves
// the data container, so also delete the file where it lives now.
onItemRemoved('map', (item) => {
  forgetEstimates();
  cancelEmergencySync(item.id);
  forgetMapSource(item.id);
  forgetSideFilesOf(item.id);
  deleteFile(resolveMapFile(item));
});

registerCompletionHandler('map', onMapFileDownloaded);
registerCompletionHandler('route', onRouteFileDownloaded);

onItemRemoved('route', (item) => {
  // The pack's emergency points and their search rows go with it.
  forgetMapSource(item.id);
  forgetSideFilesOf(item.id);
  // Valhalla has the file mapped: release it first.
  closeRouter()
    .catch(() => {})
    .finally(() => deleteFile(resolvePackFile(item)));
});
