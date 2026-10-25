// Guidance panel. With a route: car / foot / bike, the next maneuver and how far it
// is, and what is left of the trip. Without one (no routing pack for the area, or
// no way found): an arrow that points at the target (compass heading vs. bearing),
// distance and time, saying clearly that it is a straight line.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Bike,
  Car,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Download,
  Flag,
  Footprints,
  ListOrdered,
  Merge,
  Navigation,
  Navigation2,
  RotateCw,
  Ship,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, IconButton, Row, Text } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { bearingDegrees, compassSector, distanceMeters } from './geo';
import { useGuidance } from './guidance';
import { formatDistance } from './labels';
import { COSTINGS, maneuverIcon, remainingSeconds, STRAIGHT_LINE_SPEED, type Costing, type ManeuverIcon } from './routing-core';

const ARRIVED_METERS = 20;

const COSTING_ICONS: Record<Costing, LucideIcon> = { auto: Car, pedestrian: Footprints, bicycle: Bike };

export const MANEUVER_ICONS: Record<ManeuverIcon, LucideIcon> = {
  start: Navigation,
  arrive: Flag,
  straight: ArrowUp,
  slightRight: ArrowUpRight,
  right: CornerUpRight,
  sharpRight: CornerDownRight,
  slightLeft: ArrowUpLeft,
  left: CornerUpLeft,
  sharpLeft: CornerDownLeft,
  uturn: Undo2,
  roundabout: RotateCw,
  merge: Merge,
  ferry: Ship,
};

function clock(secondsFromNow: number, lang: string): string {
  return new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

export function GuidancePanel({ bottom, mapBearing }: { bottom: number; mapBearing: number }) {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const target = useGuidance((s) => s.target);
  const position = useGuidance((s) => s.position);
  const heading = useGuidance((s) => s.heading);
  const costing = useGuidance((s) => s.costing);
  const routing = useGuidance((s) => s.routing);
  const route = useGuidance((s) => s.route);
  const routeError = useGuidance((s) => s.routeError);
  const progress = useGuidance((s) => s.progress);
  const arrivedRef = useRef(false);

  const distance = target && position ? distanceMeters(position, target) : null;
  const bearing = target && position ? bearingDegrees(position, target) : null;
  // A coarse fix (approximate location: kilometres) must not count as arriving.
  const arrived = distance !== null && distance <= Math.max(ARRIVED_METERS, Math.min(position?.accuracy ?? 0, 50));
  // At the end of the route but not at the target (a hut 300 m off the road): the last
  // stretch is straight-line guidance.
  const routeDone = !!route && !!progress && progress.remainingM < 15 && progress.offRouteM < 30;

  useEffect(() => {
    if (arrived && !arrivedRef.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    arrivedRef.current = arrived;
  }, [arrived]);

  if (!target) return null;
  const following = routing === 'ready' && route && progress && !routeDone;
  const next = following ? route.maneuvers[progress.next] : null;
  const NextIcon = next ? MANEUVER_ICONS[maneuverIcon(next.type)] : null;
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
        {routing !== 'none' && !arrived ? (
          <Row gap={space.sm}>
            {COSTINGS.map((c) => (
              <Chip
                key={c}
                testID={`guidance-costing-${c}`}
                icon={COSTING_ICONS[c]}
                label={t(`route.costing.${c}`)}
                selected={c === costing}
                onPress={() => useGuidance.getState().setCosting(c)}
              />
            ))}
          </Row>
        ) : null}
        {distance === null ? (
          <Text variant="callout" color="textSecondary">
            {t('guidance.waiting')}
          </Text>
        ) : arrived ? (
          <Text variant="title2" color="success">
            {t('guidance.arrived')}
          </Text>
        ) : following && next && NextIcon ? (
          <>
            <Row gap={space.lg}>
              <View style={[styles.arrow, { backgroundColor: colors.accentSoft }]} accessibilityElementsHidden>
                <NextIcon size={36} color={colors.accent} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title1" tabular testID="guidance-next-distance">
                  {formatDistance(progress.toNextM, i18n.language)}
                </Text>
                <Text variant="callout" numberOfLines={2} testID="guidance-next">
                  {next.instruction}
                </Text>
              </View>
            </Row>
            <Row gap={space.md}>
              <Text variant="callout" color="textSecondary" style={{ flex: 1 }} testID="guidance-distance">
                {t('route.remaining', {
                  distance: formatDistance(progress.remainingM, i18n.language),
                  time: formatDuration(remainingSeconds(route, progress.remainingM)),
                  eta: clock(remainingSeconds(route, progress.remainingM), i18n.language),
                })}
              </Text>
              <Button
                testID="guidance-steps"
                title={t('route.steps')}
                icon={ListOrdered}
                variant="secondary"
                size="sm"
                onPress={() => router.push('/maps/route-steps')}
              />
            </Row>
          </>
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
                {routing === 'loading'
                  ? t('route.computing')
                  : t(`guidance.time.${routing === 'none' ? 'pedestrian' : costing}`, {
                      time: formatDuration(distance / STRAIGHT_LINE_SPEED[routing === 'none' ? 'pedestrian' : costing]),
                    })}
              </Text>
            </View>
          </Row>
        )}
        {routing === 'none' && !arrived ? (
          <Button
            testID="guidance-get-routing"
            title={t('packs.download')}
            icon={Download}
            variant="secondary"
            size="sm"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => router.push('/maps/routing-packs')}
          />
        ) : null}
        {!following && !arrived ? (
          <Text variant="caption" color="textTertiary" testID="guidance-note">
            {routing === 'error' ? `${t(`route.error.${routeError ?? 'other'}`)}\n` : ''}
            {routeDone ? `${t('route.lastStretch')}\n` : ''}
            {t('guidance.straightLine')}
            {routing === 'none' ? `\n${t('route.noPack')}` : ''}
            {position?.accuracy ? ` · ${t('guidance.accuracy', { meters: Math.round(position.accuracy) })}` : ''}
            {heading === null && distance !== null ? `\n${t('guidance.noCompass')}` : ''}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  arrow: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
