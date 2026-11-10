// Bottom card of a route preview (route-preview.ts): from where to where, time and distance, or the straight line
// when no routing pack covers it. Navigation isn't offered: it always starts from where the person is.
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card, IconButton, Row, Text } from '@/components/ui';
import { formatDistance, formatDuration, useMeasurementSystem } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { distanceMeters } from './geo';
import { clearRoutePreview, type RoutePreview } from './route-preview';

export function RoutePreviewCard({ preview, bottom }: { preview: RoutePreview; bottom: number }) {
  const { t } = useTranslation('maps');
  const system = useMeasurementSystem();
  const { colors } = useTheme();
  const { from, to, route, status } = preview;
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <Card style={{ gap: space.sm }} testID="route-preview">
        <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
          <Text variant="headline" numberOfLines={2} style={{ flex: 1 }}>
            {t('preview.title', { from: from.name, to: to.name })}
          </Text>
          <IconButton icon={X} size={36} variant="plain" accessibilityLabel={t('place.close')} onPress={clearRoutePreview} testID="route-preview-close" />
        </Row>
        {status === 'loading' ? (
          <ActivityIndicator color={colors.textSecondary} />
        ) : route ? (
          <Text variant="title3" testID="route-preview-travel">
            {`${formatDuration(route.durationS)} · ${formatDistance(route.distanceM, undefined, system)} · ${t(`preview.mode.${preview.costing}`)}`}
          </Text>
        ) : (
          <Text variant="callout" color="textSecondary">
            {t('preview.straight', { distance: formatDistance(distanceMeters(from, to), undefined, system) })}
          </Text>
        )}
        {preview.avoiding ? (
          <Text variant="footnote" color="textSecondary">
            {route ? t('preview.avoiding') : t('preview.avoidFailed')}
          </Text>
        ) : null}
        <Text variant="footnote" color="textSecondary">
          {t('preview.fromHereOnly')}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
});
