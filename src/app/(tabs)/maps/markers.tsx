import { router } from 'expo-router';
import { MapPin, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { EmptyState, IconBadge, IconButton, ListGroup, ListRow, Screen } from '@/components/ui';
import { deleteMarker, formatCoords, useMarkers, type MapMarker } from '@/features/maps/markers';
import { useMapUi } from '@/features/maps/store';
import { space, useTheme } from '@/theme';

export default function MarkersSheet() {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const markers = useMarkers((s) => s.markers);

  const flyTo = (m: MapMarker) => {
    useMapUi.getState().focus({ center: [m.lon, m.lat], zoom: Math.max(useMapUi.getState().viewport?.zoom ?? 0, 15) });
    router.back();
  };

  const confirmDelete = (m: MapMarker) =>
    Alert.alert(t('markers.deleteTitle', { name: m.name }), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => deleteMarker(m.id) },
    ]);

  if (!markers.length) {
    return (
      <Screen>
        <EmptyState icon={MapPin} hue="maps" title={t('markers.emptyTitle')} body={t('markers.emptyBody')} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <ListGroup>
        {markers.map((m) => (
          <ListRow
            key={m.id}
            leading={<IconBadge icon={MapPin} color={colors.accent} />}
            title={m.name}
            subtitle={m.note ? `${m.note}\n${formatCoords(m.lat, m.lon)}` : formatCoords(m.lat, m.lon)}
            onPress={() => flyTo(m)}
            onLongPress={() => router.push({ pathname: '/maps/marker', params: { id: String(m.id) } })}
            trailingAction={<IconButton testID="marker-delete" icon={Trash2} size={36} variant="plain" color={colors.danger} accessibilityLabel={t('common:actions.delete')} onPress={() => confirmDelete(m)} />}
          />
        ))}
      </ListGroup>
    </Screen>
  );
}
