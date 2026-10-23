// User pins (map_markers table) mirrored in a small zustand store.
import { create } from 'zustand';

import { db } from '@/db';

export type MapMarker = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  color: string | null;
  note: string | null;
  createdAt: number;
};

type Row = { id: number; name: string; lat: number; lon: number; color: string | null; note: string | null; created_at: number };

const fromRow = (r: Row): MapMarker => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, color: r.color, note: r.note, createdAt: r.created_at });

type MarkersState = { markers: MapMarker[]; refresh: () => void };

/** Loaded at startup by the maps feature init (register.ts). */
export const useMarkers = create<MarkersState>((set) => ({
  markers: [],
  refresh: () => set({ markers: db().getAllSync<Row>('SELECT * FROM map_markers ORDER BY created_at DESC').map(fromRow) }),
}));

export function getMarker(id: number): MapMarker | null {
  const row = db().getFirstSync<Row>('SELECT * FROM map_markers WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export function addMarker(input: { name: string; lat: number; lon: number; note?: string | null; color?: string | null }): number {
  const res = db().runSync(
    'INSERT INTO map_markers (name, lat, lon, color, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.name,
    input.lat,
    input.lon,
    input.color ?? null,
    input.note ?? null,
    Date.now(),
  );
  useMarkers.getState().refresh();
  return Number(res.lastInsertRowId);
}

export function updateMarker(id: number, patch: { name: string; note: string | null }) {
  db().runSync('UPDATE map_markers SET name = ?, note = ? WHERE id = ?', patch.name, patch.note, id);
  useMarkers.getState().refresh();
}

export function deleteMarker(id: number) {
  db().runSync('DELETE FROM map_markers WHERE id = ?', id);
  useMarkers.getState().refresh();
}

export function markersGeoJSON(markers: MapMarker[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      id: m.id,
      properties: { id: m.id, name: m.name },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    })),
  };
}

export function formatCoords(lat: number, lon: number, digits = 5): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}
