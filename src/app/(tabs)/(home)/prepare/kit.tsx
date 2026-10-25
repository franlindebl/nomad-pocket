import { router } from 'expo-router';
import { CalendarClock, Circle, CircleCheck, Plus } from 'lucide-react-native';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  IconButton,
  ListGroup,
  ListRow,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Text,
  triggerHaptic,
} from '@/components/ui';
import { Stepper } from '@/features/prepare/components';
import { DAY_OPTIONS, formatMonth, HOUSEHOLD_MAX, supplies } from '@/features/prepare/kit';
import { useKitGroups, type KitRow } from '@/features/prepare/rows';
import { usePrepare } from '@/features/prepare/store';
import { formatNumber } from '@/lib/format';
import { space, useTheme } from '@/theme';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      <Text variant="title3" tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export default function KitScreen() {
  const { t, i18n } = useTranslation('prepare');
  const { colors } = useTheme();
  const { data, groups, summary } = useKitGroups();
  const setHousehold = usePrepare((s) => s.setHousehold);
  const setKitEntry = usePrepare((s) => s.setKitEntry);
  const h = data.household;
  const s = supplies(h);

  const expiryBadge = (r: KitRow) => {
    if (!r.entry.expires || !r.status) return null;
    const month = formatMonth(r.entry.expires, i18n.language);
    if (r.status === 'expired') return <Badge tone="danger" label={t('kit.expired', { month })} />;
    if (r.status === 'soon') return <Badge tone="warning" label={t('kit.soon', { month })} />;
    return null;
  };

  const subtitle = (r: KitRow) => {
    const okExpiry = r.status === 'ok' && r.entry.expires ? t('kit.expires', { month: formatMonth(r.entry.expires, i18n.language) }) : '';
    return [r.detail, okExpiry, r.entry.note].filter(Boolean).join(' · ') || undefined;
  };

  return (
    <Screen>
      <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
        {t('kit.intro')}
      </Text>

      <SectionHeader title={t('kit.household')} />
      <ListGroup>
        <Stepper
          testID="adults"
          label={t('kit.adults')}
          value={h.adults}
          min={1}
          max={HOUSEHOLD_MAX}
          onChange={(adults) => setHousehold({ adults })}
        />
        <Stepper
          testID="children"
          label={t('kit.children')}
          value={h.children}
          max={HOUSEHOLD_MAX}
          onChange={(children) => setHousehold({ children })}
        />
        <Stepper testID="pets" label={t('kit.pets')} value={h.pets} max={HOUSEHOLD_MAX} onChange={(pets) => setHousehold({ pets })} />
        <View style={{ padding: space.lg }}>
          <Segmented<string>
            value={String(h.days)}
            onChange={(v) => setHousehold({ days: Number(v) })}
            options={DAY_OPTIONS.map((d) => ({ value: String(d), label: t(`kit.days.${d}`) }))}
          />
        </View>
      </ListGroup>

      <Card style={{ marginTop: space.md, gap: space.md }}>
        <Row gap={space.md} align="flex-start">
          <Stat label={t('kit.water')} value={t('kit.quantity.water', { liters: formatNumber(s.waterLiters) })} />
          <Stat label={t('kit.food')} value={`${formatNumber(s.foodKcal)} kcal`} />
          <Stat label={t('kit.medication')} value={t('kit.quantity.medication', { days: s.medicationDays })} />
        </Row>
        <ProgressBar value={summary.total ? summary.done / summary.total : 0} />
        <Text variant="footnote" color="textSecondary" testID="kit-progress">
          {t('kit.progress', { done: summary.done, total: summary.total })}
        </Text>
        <Text variant="caption" color="textTertiary">
          {t('kit.sources')}
        </Text>
      </Card>

      {groups.map((g) => (
        <Fragment key={g.category}>
          <SectionHeader title={g.title} />
          <ListGroup>
            {g.rows.map((r) => (
              <ListRow
                key={r.id}
                testID={`kit-${r.id}`}
                title={r.title}
                subtitle={subtitle(r)}
                titleLines={2}
                leading={r.entry.have ? <CircleCheck size={24} color={colors.success} /> : <Circle size={24} color={colors.textTertiary} />}
                trailing={expiryBadge(r)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: r.entry.have }}
                onPress={() => {
                  triggerHaptic('selection');
                  setKitEntry(r.id, { have: !r.entry.have });
                }}
                trailingAction={
                  <IconButton
                    testID={`kit-${r.id}-details`}
                    icon={CalendarClock}
                    variant="plain"
                    size={36}
                    color={r.entry.expires ? colors.text : colors.textTertiary}
                    accessibilityLabel={t('kit.details', { item: r.title })}
                    onPress={() => router.push({ pathname: '/prepare/item', params: { id: r.id } })}
                  />
                }
              />
            ))}
          </ListGroup>
        </Fragment>
      ))}

      <Button
        testID="kit-add"
        title={t('kit.addItem')}
        icon={Plus}
        variant="secondary"
        onPress={() => router.push('/prepare/item')}
        style={{ marginTop: space.xl, alignSelf: 'center' }}
      />
    </Screen>
  );
}
