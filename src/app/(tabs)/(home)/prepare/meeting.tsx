import { router, useLocalSearchParams } from 'expo-router';
import { Circle, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, ListGroup, ListRow, Screen, Text } from '@/components/ui';
import { formatCoords, useMarkers } from '@/features/maps/markers';
import { useMapUi } from '@/features/maps/store';
import { Field, SheetHeader } from '@/features/prepare/components';
import { usePrepare } from '@/features/prepare/store';
import type { MeetingSlot } from '@/features/prepare/types';
import { space, useTheme } from '@/theme';

export default function MeetingSheet() {
  const { t } = useTranslation('prepare');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ slot: MeetingSlot }>();
  const slot: MeetingSlot = params.slot === 'secondary' ? 'secondary' : 'primary';
  const existing = usePrepare((s) => s.meeting[slot]);
  const markers = useMarkers((s) => s.markers);
  const [place, setPlace] = useState(existing?.place ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [markerId, setMarkerId] = useState<number | null>(existing?.markerId ?? null);

  const marker = markers.find((m) => m.id === markerId) ?? null;
  // A deleted pin keeps its copied coordinates.
  const lat = marker?.lat ?? (markerId === existing?.markerId ? existing?.lat : null) ?? null;
  const lon = marker?.lon ?? (markerId === existing?.markerId ? existing?.lon : null) ?? null;

  const save = () => {
    const name = place.trim() || marker?.name || '';
    if (!name && lat == null) {
      usePrepare.getState().setMeeting(slot, null);
    } else {
      usePrepare.getState().setMeeting(slot, { place: name, details: details.trim(), markerId: lat == null ? null : markerId, lat, lon });
    }
    router.back();
  };

  const showOnMap = () => {
    if (lat == null || lon == null) return;
    const ui = useMapUi.getState();
    const zoom = Math.max(ui.viewport?.zoom ?? 0, 15);
    // The viewport is where a map that mounts now opens; focus() moves one already mounted.
    const d = 0.01;
    ui.setViewport({ center: [lon, lat], zoom, bounds: [lon - d, lat - d, lon + d, lat + d] });
    router.back();
    router.navigate('/maps');
    // A hidden tab's map ignores camera moves: ask once the Maps tab is on screen.
    setTimeout(() => ui.focus({ center: [lon, lat], zoom }), 600);
  };

  const pick = (id: number | null) => {
    setMarkerId(id);
    const m = markers.find((x) => x.id === id);
    if (m && !place.trim()) setPlace(m.name);
  };

  const check = (on: boolean) => (on ? <CircleCheck size={22} color={colors.accent} /> : <Circle size={22} color={colors.textTertiary} />);

  return (
    <Screen automaticallyAdjustKeyboardInsets contentStyle={{ gap: space.lg, paddingTop: space.lg }}>
      <SheetHeader title={t(`meeting.${slot}`)} onSave={save} saveTestID="meeting-save" />
      <Text variant="footnote" color="textSecondary">
        {t(`meeting.${slot}Hint`)}
      </Text>
      <Field
        testID="meeting-place"
        label={t('meeting.place')}
        placeholder={t('meeting.placePlaceholder')}
        value={place}
        onChangeText={setPlace}
        autoFocus={!existing}
      />
      <Field
        testID="meeting-details"
        label={t('meeting.details')}
        placeholder={t('meeting.detailsPlaceholder')}
        value={details}
        onChangeText={setDetails}
        multiline
      />

      <View style={{ gap: space.sm }}>
        <Text variant="overline" color="textSecondary">
          {t('meeting.pin')}
        </Text>
        {markers.length ? (
          <ListGroup>
            {[
              <ListRow
                key="none"
                title={t('meeting.noPin')}
                leading={check(markerId == null)}
                onPress={() => pick(null)}
                accessibilityRole="radio"
                accessibilityState={{ checked: markerId == null }}
              />,
              ...markers.map((m) => (
                <ListRow
                  key={m.id}
                  testID={`meeting-pin-${m.id}`}
                  title={m.name}
                  subtitle={formatCoords(m.lat, m.lon, 4)}
                  leading={check(markerId === m.id)}
                  onPress={() => pick(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: markerId === m.id }}
                />
              )),
            ]}
          </ListGroup>
        ) : (
          <Text variant="footnote" color="textSecondary">
            {t('meeting.noMarkers')}
          </Text>
        )}
        {lat != null && lon != null && !marker ? (
          <Text variant="footnote" color="textSecondary" tabular>
            {formatCoords(lat, lon)}
          </Text>
        ) : null}
      </View>

      {lat != null ? <Button title={t('meeting.showOnMap')} variant="secondary" onPress={showOnMap} fullWidth /> : null}
      {existing ? (
        <Button
          title={t('meeting.remove')}
          variant="danger"
          fullWidth
          onPress={() => {
            usePrepare.getState().setMeeting(slot, null);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}
