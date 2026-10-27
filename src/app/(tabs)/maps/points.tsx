// Puntos sheet: what each coloured dot on the map is, and switches to hide them
// all or by category. A legend and the settings in one place, next to the dots.
import { useTranslation } from 'react-i18next';

import { ListGroup, ListRow, Screen, SectionHeader, Switch, Text } from '@/components/ui';
import { EMERGENCY_CATEGORIES } from '@/features/maps/emergency-core';
import { CATEGORY_COLORS } from '@/features/maps/labels';
import { PointDot } from '@/features/maps/PointDot';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

export default function PointsSheet() {
  const { t } = useTranslation('maps');
  const shown = useSettings((s) => s.mapPoints);
  const hidden = useSettings((s) => s.hiddenPointCategories);
  const { setMapPoints, setPointCategoryHidden } = useSettings.getState();

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <ListGroup>
        <ListRow
          testID="points-show"
          title={t('points.show')}
          subtitle={t('points.showBody')}
          subtitleLines={3}
          trailing={<Switch value={shown} onValueChange={setMapPoints} accessibilityLabel={t('points.show')} />}
        />
      </ListGroup>

      <SectionHeader title={t('points.legend')} />
      <ListGroup>
        {EMERGENCY_CATEGORIES.map((c) => {
          const on = !hidden.includes(c);
          return (
            <ListRow
              key={c}
              testID={`points-${c}`}
              leading={<PointDot color={CATEGORY_COLORS[c]} size={18} />}
              title={t(`emergency.category.${c}`)}
              subtitle={t(`points.kinds.${c}`)}
              subtitleLines={3}
              trailing={
                shown ? (
                  <Switch
                    value={on}
                    onValueChange={(v) => setPointCategoryHidden(c, !v)}
                    accessibilityLabel={t(`emergency.category.${c}`)}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>

      <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md, paddingHorizontal: space.sm }}>
        {t('points.footer')}
      </Text>
    </Screen>
  );
}
