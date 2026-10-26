import { router, useLocalSearchParams } from 'expo-router';
import { Navigation } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Row, Text } from '@/components/ui';
import { startGuidance } from '@/features/maps/guidance';
import { addMarker, deleteMarker, formatCoords, getMarker, updateMarker, useMarkers } from '@/features/maps/markers';
import { useMapUi } from '@/features/maps/store';
import { fontFamily, radius, space, typography, useTheme } from '@/theme';

export default function MarkerSheet() {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; lat?: string; lon?: string }>();
  const existing = params.id ? getMarker(Number(params.id)) : null;
  const lat = existing?.lat ?? Number(params.lat);
  const lon = existing?.lon ?? Number(params.lon);
  const count = useMarkers((s) => s.markers.length);
  const [name, setName] = useState(existing?.name ?? '');
  const [note, setNote] = useState(existing?.note ?? '');

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const save = () => {
    const finalName = name.trim() || t('markers.defaultName', { n: count + 1 });
    const finalNote = note.trim() || null;
    if (existing) updateMarker(existing.id, { name: finalName, note: finalNote });
    else addMarker({ name: finalName, lat, lon, note: finalNote });
    router.back();
  };

  const input = [styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text, fontFamily }];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingBottom: space.xl }]}>
      <Text variant="title2" align="center">
        {existing ? t('markers.edit') : t('markers.new')}
      </Text>
      <View style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          {t('markers.coordinates')}
        </Text>
        <Text variant="callout" tabular selectable>
          {formatCoords(lat, lon)}
        </Text>
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="overline" color="textSecondary">
          {t('markers.name')}
        </Text>
        <TextInput
          testID="marker-name"
          value={name}
          onChangeText={setName}
          placeholder={t('markers.namePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus={!existing}
          returnKeyType="done"
          onSubmitEditing={save}
          style={input}
          accessibilityLabel={t('markers.name')}
        />
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="overline" color="textSecondary">
          {t('markers.note')}
        </Text>
        <TextInput
          testID="marker-note"
          value={note}
          onChangeText={setNote}
          placeholder={t('markers.notePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[input, styles.multiline]}
          accessibilityLabel={t('markers.note')}
        />
      </View>
      <Button title={t('common:actions.save')} onPress={save} size="lg" fullWidth />
      {existing ? (
        <Button
          testID="marker-guide"
          title={t('markers.takeMeThere')}
          icon={Navigation}
          variant="secondary"
          fullWidth
          onPress={async () => {
            // Location denied: startGuidance says so and offers Settings; the sheet stays.
            if (await startGuidance({ name: existing.name, lat: existing.lat, lon: existing.lon })) router.back();
          }}
        />
      ) : null}
      {existing ? (
        <Row gap={space.sm}>
          <Button
            title={t('markers.showOnMap')}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              useMapUi.getState().focus({ center: [lon, lat], zoom: Math.max(useMapUi.getState().viewport?.zoom ?? 0, 15) });
              router.back();
            }}
          />
          <Button
            title={t('common:actions.delete')}
            variant="danger"
            style={{ flex: 1 }}
            onPress={() => {
              deleteMarker(existing.id);
              router.back();
            }}
          />
        </Row>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space.gutter, paddingTop: space.xl, gap: space.lg },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: typography.body.fontSize,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
