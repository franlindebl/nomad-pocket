import { router } from 'expo-router';
import { Crosshair, MapPin } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconBadge, ListGroup, ListRow, Screen, SearchField, SectionHeader, Text } from '@/components/ui';
import { useItems } from '@/features/content/items';
import { distanceMeters, formatLatLon, formatUtm, parseCoordinates, toUtm, type LatLon } from '@/features/maps/geo';
import { distanceWithDirection, kindColor, kindIcon, kindLabel } from '@/features/maps/labels';
import { useMarkers } from '@/features/maps/markers';
import { normalizeName } from '@/features/maps/places-core';
import { hasSearchIndex, searchPlaces, usePlaceIndex } from '@/features/maps/places';
import { showPlace, useMapUi, type SelectedPlace } from '@/features/maps/store';
import { space, useTheme } from '@/theme';

// A plain scroll view (Screen) like the region picker: a virtualized list gets
// no height inside a formSheet. Results are capped at 40.
export default function SearchSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const markers = useMarkers((s) => s.markers);
  const maps = useItems('map');
  const progress = usePlaceIndex((s) => s.progress);
  const indexVersion = usePlaceIndex((s) => s.version);
  // Rank by closeness to what the map shows, which is usually where the user is looking.
  const near = useMemo<LatLon | null>(() => {
    const c = useMapUi.getState().viewport?.center;
    return c ? { lon: c[0], lat: c[1] } : null;
  }, []);

  const coords = useMemo(() => parseCoordinates(deferred), [deferred]);
  const results = useMemo(
    () => (deferred.length >= 2 ? searchPlaces(deferred, near) : []),
    // indexVersion: search again when an index finishes building.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferred, near, indexVersion],
  );
  const savedHits = useMemo(() => {
    if (deferred.length < 2) return [];
    const q = normalizeName(deferred);
    return markers.filter((m) => normalizeName(m.name).includes(q)).slice(0, 5);
  }, [deferred, markers]);

  const go = (p: SelectedPlace) => {
    showPlace(p);
    router.back();
  };
  const away = (p: LatLon) => (near ? distanceWithDirection(t, i18n.language, near, p, distanceMeters(near, p)) : null);
  const indexing = Object.entries(progress)
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
          {t('search.indexing', { name: indexing.name, percent: Math.round(indexing.value * 100) })}
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
            {results.map((r) => (
              <ListRow
                key={r.id}
                testID="search-result"
                leading={<IconBadge icon={kindIcon(r.kind, r.layer)} color={kindColor(r.kind)} />}
                title={r.name}
                subtitle={[kindLabel(t, r.kind), r.context, away(r)].filter(Boolean).join(' · ')}
                onPress={() => go({ name: r.name, lat: r.lat, lon: r.lon, kind: r.kind, layer: r.layer, context: r.context })}
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      {!results.length && !coords && !savedHits.length ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ marginTop: space.xxl, paddingHorizontal: space.lg }}>
          {!maps.length
            ? t('search.noMaps')
            : deferred.length >= 2 && hasSearchIndex()
              ? t('search.noResults', { query: deferred })
              : t('search.hint')}
        </Text>
      ) : null}
    </Screen>
  );
}
