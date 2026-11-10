// The places picked in the map's search (a result, coordinates or a saved place), newest first, offered again
// when the search opens with nothing typed. On the phone only (nomad.db): nothing leaves it.
import { Alert } from 'react-native';

import { db } from '@/db';
import i18n from '@/i18n';

import type { SelectedPlace } from './store';

export type RecentPlace = SelectedPlace & { id: number; chosenAt: number };

/** Kept at most: older ones are dropped as new ones come in. */
const MAX_RECENT = 100;
/** The same place picked again moves to the top instead of showing twice (~50 m). */
const SAME_DEGREES = 0.0005;

type Row = {
  id: number;
  name: string;
  native_name: string | null;
  kind: string | null;
  layer: string | null;
  context: string | null;
  lat: number;
  lon: number;
  chosen_at: number;
};

export function recordSearchChoice(p: SelectedPlace) {
  const d = db();
  d.withTransactionSync(() => {
    d.runSync(
      'DELETE FROM map_search_history WHERE name = ? AND abs(lat - ?) < ? AND abs(lon - ?) < ?',
      p.name,
      p.lat,
      SAME_DEGREES,
      p.lon,
      SAME_DEGREES,
    );
    d.runSync(
      'INSERT INTO map_search_history (name, native_name, kind, layer, context, lat, lon, chosen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.name,
      p.nativeName ?? null,
      p.kind ?? null,
      p.layer ?? null,
      p.context ?? null,
      p.lat,
      p.lon,
      Date.now(),
    );
    d.runSync(
      'DELETE FROM map_search_history WHERE id NOT IN (SELECT id FROM map_search_history ORDER BY chosen_at DESC, id DESC LIMIT ?)',
      MAX_RECENT,
    );
  });
}

export function recentSearches(): RecentPlace[] {
  return db()
    .getAllSync<Row>('SELECT * FROM map_search_history ORDER BY chosen_at DESC, id DESC')
    .map((r) => ({
      id: r.id,
      name: r.name,
      nativeName: r.native_name,
      kind: r.kind,
      layer: r.layer,
      context: r.context,
      lat: r.lat,
      lon: r.lon,
      chosenAt: r.chosen_at,
    }));
}

export function clearSearchHistory() {
  db().runSync('DELETE FROM map_search_history');
}

/** "Limpiar" on the search's recent places: asks first, then clears and calls `onCleared`. */
export function confirmClearSearchHistory(onCleared: () => void) {
  const t = i18n.getFixedT(null, 'maps');
  const tc = i18n.getFixedT(null, 'common');
  Alert.alert(t('search.recent.clearTitle'), t('search.recent.clearBody'), [
    { text: tc('actions.cancel'), style: 'cancel' },
    {
      text: tc('actions.clear'),
      style: 'destructive',
      onPress: () => {
        clearSearchHistory();
        onCleared();
      },
    },
  ]);
}
