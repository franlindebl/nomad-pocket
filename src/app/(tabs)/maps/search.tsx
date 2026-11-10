import { router } from 'expo-router';
import { Crosshair, MapPin } from 'lucide-react-native';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconBadge, ListGroup, ListRow, Screen, SearchField, SectionHeader, Text } from '@/components/ui';
import { useItems } from '@/features/content/items';
import { distanceMeters, formatLatLon, formatUtm, parseCoordinates, toUtm, type LatLon } from '@/features/maps/geo';
import { distanceWithDirection, kindColor, kindIcon, kindLabel } from '@/features/maps/labels';
import { useMarkers } from '@/features/maps/markers';
import { localizedName, normalizeName } from '@/features/maps/places-core';
import { usePreparingCountries } from '@/features/maps/countries';
import { hasSearchIndex, indexDetailAroundView, searchPlaces, usePlaceIndex, type SearchResult } from '@/features/maps/places';
import { confirmClearSearchHistory, recentSearches, recordSearchChoice } from '@/features/maps/search-history';
import { showPlace, useMapUi, type SelectedPlace } from '@/features/maps/store';
import * as Location from '@/lib/location';
import { space, useTheme } from '@/theme';

/** Typing pause before searching: each search reads a country-sized index. */
const SEARCH_DELAY = 200;

// A plain scroll view (Screen) like the region picker: a virtualized list gets
// no height inside a formSheet. Results are capped at 40, recent places at 100.
export default function SearchSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const markers = useMarkers((s) => s.markers);
  const maps = useItems('map');
  const progress = usePlaceIndex((s) => s.progress);
  const indexVersion = usePlaceIndex((s) => s.version);
  // Where the person is (the last fix, no prompt: the map asks for the permission).
  const [here, setHere] = useState<LatLon | null>(null);
  useEffect(() => {
    let live = true;
    Location.getForegroundPermissionsAsync()
      .then((p) => (p.granted ? Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }) : null))
      .then((pos) => {
        if (live && pos) setHere({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // Results are ranked by closeness (places-core hitScore): to the person, unless the map shows somewhere else
  // (they moved it to look there), then to what it shows.
  const near = useMemo<LatLon | null>(() => {
    const v = useMapUi.getState().viewport;
    if (here && (!v || inBounds(here, v.bounds))) return here;
    return v ? { lon: v.center[0], lat: v.center[1] } : here;
  }, [here]);
  // Distances are said from the person when known ("2 km NE" from where they stand).
  const from = here ?? near;
  const [recent, setRecent] = useState(recentSearches);
  // Big maps are indexed coarsely: add the detail (schools, shops…) of the area shown (not for a
  // country whose search files are in: places.ts).
  useEffect(() => indexDetailAroundView(), []);

  const coords = useMemo(() => parseCoordinates(deferred), [deferred]);
  // The index search runs off the JS thread once typing pauses; a newer one makes an
  // older one stop and its results are dropped.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTyped(query.trim()), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [query]);
  const [found, setFound] = useState<{ query: string; results: SearchResult[] }>({ query: '', results: [] });
  const searchId = useRef(0);
  useEffect(() => {
    const id = ++searchId.current;
    if (typed.length < 2) return;
    const current = () => id === searchId.current;
    searchPlaces(typed, near, 40, current)
      .then((r) => {
        if (current()) setFound({ query: typed, results: r });
      })
      .catch((e) => console.warn('[maps] search failed', e));
    // indexVersion: search again when an index finishes building.
  }, [typed, near, indexVersion]);
  // The last results stay up while the next search runs.
  const results = deferred.length >= 2 ? found.results : [];
  const searching = deferred.length >= 2 && (found.query !== typed || typed !== deferred);
  const savedHits = useMemo(() => {
    if (deferred.length < 2) return [];
    const q = normalizeName(deferred);
    return markers.filter((m) => normalizeName(m.name).includes(q)).slice(0, 5);
  }, [deferred, markers]);

  // Name in the app language (native one as a subtitle); an unnamed point shows its kind.
  const shown = (r: SearchResult) => {
    const l = localizedName(r, i18n.language);
    return { name: l.name || kindLabel(t, r.kind), native: l.native };
  };

  const go = (p: SelectedPlace) => {
    recordSearchChoice(p);
    showPlace(p);
    router.back();
  };
  const away = (p: LatLon) => (from ? distanceWithDirection(t, from, p, distanceMeters(from, p)) : null);
  // A country still being prepared after its download (all of its search), else a map's tiles being indexed.
  const preparing = usePreparingCountries().at(0);
  const indexing = preparing
    ? { name: preparing.title, value: preparing.preparing ?? 0 }
    : Object.entries(progress)
        .map(([id, value]) => ({ name: maps.find((m) => m.id === id)?.title ?? id, value }))
        .at(0);

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <SearchField
        testID="search-input"
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder={t('search.placeholder')}
        autoFocus
        accessibilityLabel={t('controls.search')}
      />

      {indexing ? (
        <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }}>
          {t('search.indexing', { name: indexing.name, percent: Math.floor(indexing.value * 100) })}
        </Text>
      ) : null}

      {coords ? (
        <>
          <SectionHeader title={t('markers.coordinates')} />
          <ListGroup>
            <ListRow
              testID="search-coordinates"
              leading={<IconBadge icon={Crosshair} color={colors.accent} />}
              title={t('search.coordinates')}
              subtitle={`${formatLatLon(coords.lat, coords.lon)}${toUtm(coords.lat, coords.lon) ? `\nUTM ${formatUtm(toUtm(coords.lat, coords.lon)!)}` : ''}`}
              onPress={() => go({ name: formatLatLon(coords.lat, coords.lon), lat: coords.lat, lon: coords.lon })}
            />
          </ListGroup>
        </>
      ) : null}

      {savedHits.length ? (
        <>
          <SectionHeader title={t('markers.title')} />
          <ListGroup>
            {savedHits.map((m) => (
              <ListRow
                key={m.id}
                leading={<IconBadge icon={MapPin} color={colors.accent} />}
                title={m.name}
                subtitle={away(m) ?? undefined}
                onPress={() => go({ name: m.name, lat: m.lat, lon: m.lon })}
              />
            ))}
          </ListGroup>
        </>
      ) : null}

      {results.length ? (
        <View style={{ marginTop: coords || savedHits.length ? 0 : space.lg }}>
          {coords || savedHits.length ? <SectionHeader title={t('title')} /> : null}
          <ListGroup>
            {results.map((r) => {
              const { name, native } = shown(r);
              return (
                <ListRow
                  key={r.id}
                  testID="search-result"
                  leading={<IconBadge icon={kindIcon(r.kind, r.layer)} color={kindColor(r.kind)} />}
                  title={name}
                  subtitle={[kindLabel(t, r.kind), native, r.context, away(r)].filter(Boolean).join(' · ')}
                  onPress={() =>
                    go({ name, nativeName: native ?? (r.name || null), lat: r.lat, lon: r.lon, kind: r.kind, layer: r.layer, context: r.context })
                  }
                />
              );
            })}
          </ListGroup>
        </View>
      ) : null}

      {deferred.length < 2 && recent.length ? (
        <>
          <SectionHeader
            title={t('search.recent.title')}
            action={t('search.recent.clear')}
            onAction={() => confirmClearSearchHistory(() => setRecent([]))}
            quietAction
            actionTestID="search-recent-clear"
          />
          <ListGroup>
            {recent.map((r) => (
              <ListRow
                key={r.id}
                testID="search-recent"
                leading={<IconBadge icon={kindIcon(r.kind, r.layer ?? undefined)} color={kindColor(r.kind)} />}
                title={r.name}
                subtitle={[r.kind ? kindLabel(t, r.kind) : null, r.context, away(r)].filter(Boolean).join(' · ')}
                onPress={() => go({ name: r.name, nativeName: r.nativeName, lat: r.lat, lon: r.lon, kind: r.kind, layer: r.layer, context: r.context })}
              />
            ))}
          </ListGroup>
        </>
      ) : null}

      {!results.length && !coords && !savedHits.length && !(deferred.length < 2 && recent.length) ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ marginTop: space.xxl, paddingHorizontal: space.lg }}>
          {!maps.length && !hasSearchIndex()
            ? t('search.noMaps')
            : deferred.length >= 2 && hasSearchIndex()
              ? searching
                ? ' '
                : t('search.noResults', { query: deferred })
              : t('search.hint')}
        </Text>
      ) : null}
    </Screen>
  );
}

/** Whether a point is inside the map's visible box (west, south, east, north; across the antimeridian too). */
function inBounds(p: LatLon, [w, s, e, n]: [number, number, number, number]): boolean {
  if (p.lat < s || p.lat > n) return false;
  return w <= e ? p.lon >= w && p.lon <= e : p.lon >= w || p.lon <= e;
}
