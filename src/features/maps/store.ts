// Map screen state shared with its sheets: the last viewport (persisted so the
// map reopens where it was) and one-shot camera requests (fly to a marker...).
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import type { BBox } from '@/lib/pmtiles';

export type Viewport = { center: [number, number]; zoom: number; bounds: BBox };

export type CameraRequest = { center: [number, number]; zoom?: number } | { bounds: BBox };

type MapUiState = {
  viewport: Viewport | null;
  request: (CameraRequest & { seq: number }) | null;
  setViewport: (v: Viewport) => void;
  focus: (r: CameraRequest) => void;
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
  setViewport: (viewport) => {
    set({ viewport });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Storage.setItemSync(KEY, JSON.stringify(viewport)), 1000);
  },
  focus: (r) => set((s) => ({ request: { ...r, seq: (s.request?.seq ?? 0) + 1 } })),
}));
