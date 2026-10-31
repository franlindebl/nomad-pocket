import { useMemo } from 'react';

import { useItems, type InstalledItem } from '@/features/content/items';
import { contentFile } from '@/lib/storage';

import { mapItemId, WORLD_ID, type MapItemMeta } from './extraction';

export type MapItem = InstalledItem & { meta: MapItemMeta };

/**
 * Current URI of a map item's file. iOS moves the app data container (new UUID)
 * on reinstall/update, so the absolute path stored at install time goes stale:
 * resolve by file name inside today's content/maps directory.
 */
export function resolveMapFile(item: Pick<InstalledItem, 'fileUri'>): string {
  const name = decodeURIComponent(item.fileUri.split('/').pop() ?? '');
  return name ? contentFile('map', name).uri : item.fileUri;
}

/** Map items with today's file URIs: the world basemap first, then regions by detail (more detail on top). */
export function sortMapItems(items: MapItem[]): { world: MapItem | undefined; regions: MapItem[]; all: MapItem[] } {
  const resolved = items.map((i) => ({ ...i, fileUri: resolveMapFile(i) }));
  const world = resolved.find((i) => i.id === mapItemId(WORLD_ID));
  const regions = resolved
    .filter((i) => i.id !== mapItemId(WORLD_ID))
    .sort((a, b) => (a.meta.maxZoom ?? 0) - (b.meta.maxZoom ?? 0) || a.installedAt - b.installedAt);
  return { world, regions, all: world ? [world, ...regions] : regions };
}

/** Installed map items, sorted as sortMapItems does. */
export function useMapItems(): { world: MapItem | undefined; regions: MapItem[]; all: MapItem[] } {
  const items = useItems('map') as MapItem[];
  return useMemo(() => sortMapItems(items), [items]);
}
