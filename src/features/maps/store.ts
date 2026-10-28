// Map screen state shared with its sheets: the last viewport (persisted so the
// map reopens where it was), one-shot camera requests (fly to a marker...) and
// the place shown in the bottom card (a search result or a tapped point).
import { create } from 'zustand';

import Storage from '@/db/kv';
import type { BBox } from '@/lib/pmtiles';

export type Viewport = { center: [number, number]; zoom: number; bounds: BBox };

export type CameraRequest = { center: [number, number]; zoom?: number } | { bounds: BBox };

/** What the place card shows. `osmId` links an emergency point (details from map_pois). */
export type SelectedPlace = {
  name: string;
  /** The name in the data's own language when `name` is a translation (shown under it; emergency lookups match it). */
  nativeName?: string | null;
  lat: number;
  lon: number;
  kind?: string | null;
  layer?: string | null;
  context?: string | null;
  osmId?: string | null;
};

type MapUiState = {
  viewport: Viewport | null;
  request: (CameraRequest & { seq: number }) | null;
  selected: SelectedPlace | null;
  setViewport: (v: Viewport) => void;
  focus: (r: CameraRequest) => void;
  select: (p: SelectedPlace | null) => void;
};

const KEY = 'maps.viewport';

function loadViewport(): Viewport | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as Viewport) : null;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useMapUi = create<MapUiState>((set) => ({
  viewport: loadViewport(),
  request: null,
  selected: null,
  setViewport: (viewport) => {
    set({ viewport });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Storage.setItemSync(KEY, JSON.stringify(viewport)), 1000);
  },
  focus: (r) => set((s) => ({ request: { ...r, seq: (s.request?.seq ?? 0) + 1 } })),
  select: (selected) => set({ selected }),
}));

/** Shows a place in the card and flies there (from search, emergency list, markers). */
export function showPlace(p: SelectedPlace, zoom = 16) {
  const ui = useMapUi.getState();
  ui.select(p);
  ui.focus({ center: [p.lon, p.lat], zoom: Math.max(ui.viewport?.zoom ?? 0, zoom) });
}
