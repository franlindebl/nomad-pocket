// Maps feature wiring: startup init and item-removal hook.
import { registerInit } from '@/features/bootstrap';
import { onItemRemoved } from '@/features/content/items';
import { deleteFile, partialDir } from '@/lib/storage';

import { forgetEstimates } from './extraction';
import { useMarkers } from './markers';
import { resolveMapFile } from './useMapSources';

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
});

// The map screen drops the source from its style as soon as the items list
// refreshes. removeItem deletes the stored path, which is stale after iOS moves
// the data container, so also delete the file where it lives now.
onItemRemoved('map', (item) => {
  forgetEstimates();
  deleteFile(resolveMapFile(item));
});
