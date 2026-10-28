import { Route as RouteIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Badge, EmptyState, IconBadge, ListGroup, ListRow, Row, Screen, Text } from '@/components/ui';
import { MANEUVER_ICONS } from '@/features/maps/GuidancePanel';
import { useGuidance } from '@/features/maps/guidance';
import { maneuverIcon } from '@/features/maps/routing-core';
import { formatDistance, formatDuration } from '@/lib/format';
import { space, useTheme } from '@/theme';

/** The current route's maneuvers, the next one highlighted. */
export default function RouteStepsSheet() {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const route = useGuidance((s) => s.route);
  const next = useGuidance((s) => s.progress?.next ?? 0);

  if (!route) {
    return (
      <Screen>
        <EmptyState icon={RouteIcon} hue="maps" title={t('route.noRoute')} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: space.lg, gap: space.md }}>
      <Row gap={space.sm} style={{ paddingHorizontal: space.xs, flexWrap: 'wrap' }}>
        <Text variant="headline" testID="route-summary">
          {t('route.summary', { distance: formatDistance(route.distanceM), time: formatDuration(route.durationS) })}
        </Text>
        {route.hasToll ? <Badge label={t('route.toll')} tone="warning" /> : null}
        {route.hasFerry ? <Badge label={t('route.ferry')} tone="neutral" /> : null}
      </Row>
      <ListGroup>
        {route.maneuvers.map((m, i) => (
          <ListRow
            key={`${m.begin}-${i}`}
            testID="route-step"
            leading={<IconBadge icon={MANEUVER_ICONS[maneuverIcon(m.type)]} color={i === next ? colors.accent : colors.textSecondary} />}
            title={m.instruction}
            titleLines={3}
            subtitle={m.distanceM > 0 ? formatDistance(m.distanceM) : undefined}
          />
        ))}
      </ListGroup>
    </Screen>
  );
}
