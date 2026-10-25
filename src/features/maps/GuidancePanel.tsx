// Straight-line guidance panel: an arrow that points at the target (compass
// heading vs. bearing), distance, walking time and how good the GPS fix is.
// Deliberately says it is a straight line: it knows nothing about roads.
import * as Haptics from 'expo-haptics';
import { Navigation2, X } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card, IconButton, Row, Text } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { bearingDegrees, compassSector, distanceMeters } from './geo';
import { useGuidance } from './guidance';
import { formatDistance } from './labels';

/** Walking speed for the time estimate (m/s, ~4.5 km/h). */
const WALK_SPEED = 1.25;
const ARRIVED_METERS = 20;

export function GuidancePanel({ bottom, mapBearing }: { bottom: number; mapBearing: number }) {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const target = useGuidance((s) => s.target);
  const position = useGuidance((s) => s.position);
  const heading = useGuidance((s) => s.heading);
  const arrivedRef = useRef(false);

  const distance = target && position ? distanceMeters(position, target) : null;
  const bearing = target && position ? bearingDegrees(position, target) : null;
  // A coarse fix (approximate location: kilometres) must not count as arriving.
  const arrived = distance !== null && distance <= Math.max(ARRIVED_METERS, Math.min(position?.accuracy ?? 0, 50));

  useEffect(() => {
    if (arrived && !arrivedRef.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    arrivedRef.current = arrived;
  }, [arrived]);

  if (!target) return null;
  // Relative to where the phone points; without a compass, relative to the map's north.
  const rotation = bearing === null ? 0 : bearing - (heading ?? mapBearing);

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <Card style={{ gap: space.md }} testID="guidance-panel">
        <Row gap={space.md}>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {t('guidance.toward', { name: target.name })}
          </Text>
          <IconButton
            testID="guidance-stop"
            icon={X}
            size={32}
            accessibilityLabel={t('guidance.stop')}
            onPress={() => useGuidance.getState().stop()}
          />
        </Row>
        {distance === null ? (
          <Text variant="callout" color="textSecondary">
            {t('guidance.waiting')}
          </Text>
        ) : arrived ? (
          <Text variant="title2" color="success">
            {t('guidance.arrived')}
          </Text>
        ) : (
          <Row gap={space.lg}>
            <View
              style={[styles.arrow, { backgroundColor: colors.accentSoft }]}
              accessibilityLabel={t(`dir.${compassSector(bearing ?? 0)}`)}
              accessibilityRole="image">
              <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
                <Navigation2 size={40} color={colors.accent} fill={colors.accent} strokeWidth={1.5} />
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title1" tabular testID="guidance-distance">
                {formatDistance(distance, i18n.language)} {t(`dir.${compassSector(bearing ?? 0)}`)}
              </Text>
              <Text variant="callout" color="textSecondary">
                {t('guidance.walk', { time: formatDuration(distance / WALK_SPEED) })}
              </Text>
            </View>
          </Row>
        )}
        <Text variant="caption" color="textTertiary">
          {t('guidance.straightLine')}
          {position?.accuracy ? ` · ${t('guidance.accuracy', { meters: Math.round(position.accuracy) })}` : ''}
          {heading === null && distance !== null ? `\n${t('guidance.noCompass')}` : ''}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  arrow: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
