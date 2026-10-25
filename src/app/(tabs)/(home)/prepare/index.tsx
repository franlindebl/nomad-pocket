import { router } from 'expo-router';
import { Backpack, ChevronRight, FileDown, Users, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Badge, Button, Card, IconBadge, ListGroup, ProgressBar, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { getResource, matchesLanguages } from '@/features/catalog';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { resetPrepare } from '@/features/prepare/reminders';
import { useKitGroups } from '@/features/prepare/rows';
import { sharePlanPdf } from '@/features/prepare/share';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

/** Catalog archives worth having before an emergency, best first. */
const GUIDES = [
  'ready.gov_es_all',
  'ready.gov_en_all',
  'zimgit-post-disaster_en',
  'zimgit-medicine_en',
  'zimgit-water_en',
  'zimgit-food-preparation_en',
];

function HubCard({
  icon,
  title,
  body,
  onPress,
  testID,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
  /** Read after the body (the card's children are merged into one label). */
  status?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Card onPress={onPress} testID={testID} accessibilityLabel={[title, body, status].filter(Boolean).join(', ')} style={{ gap: space.md }}>
      <Row gap={space.md}>
        <IconBadge icon={icon} hue="survival" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{title}</Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {body}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </Row>
      {children}
    </Card>
  );
}

export default function PrepareScreen() {
  const { t } = useTranslation('prepare');
  const { t: tc } = useTranslation();
  const { data, summary } = useKitGroups();
  const contentLanguages = useSettings((s) => s.contentLanguages);
  const [exporting, setExporting] = useState(false);
  const guides = GUIDES.map(getResource).filter((r) => r && matchesLanguages(r, contentLanguages));

  const planBody = [
    data.meeting.primary?.place,
    summary.contacts ? t('home.contacts', { count: summary.contacts }) : '',
    data.people.length ? t('plan.people') : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const exportPdf = async () => {
    setExporting(true);
    try {
      await sharePlanPdf();
    } catch (e) {
      console.warn('[prepare] export failed', e);
      Alert.alert(t('hub.exportFailed'), String((e as Error)?.message ?? e));
    } finally {
      setExporting(false);
    }
  };

  const confirmReset = () =>
    Alert.alert(t('hub.resetTitle'), t('hub.resetBody'), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => void resetPrepare() },
    ]);

  return (
    <Screen contentStyle={{ gap: space.md }}>
      <Text variant="callout" color="textSecondary" style={{ marginBottom: space.xs }}>
        {t('hub.intro')}
      </Text>

      <HubCard
        icon={Users}
        title={t('hub.planTitle')}
        body={planBody || t('hub.planEmpty')}
        onPress={() => router.push('/prepare/plan')}
        testID="prepare-plan"
      />

      <HubCard
        icon={Backpack}
        title={t('hub.kitTitle')}
        body={summary.done ? t('kit.progress', { done: summary.done, total: summary.total }) : t('hub.kitEmpty')}
        status={summary.attention ? t('home.attention', { count: summary.attention }) : undefined}
        onPress={() => router.push('/prepare/kit')}
        testID="prepare-kit">
        {summary.done || summary.attention ? (
          <View style={{ gap: space.sm }}>
            <ProgressBar value={summary.total ? summary.done / summary.total : 0} />
            {summary.attention ? <Badge tone="warning" label={t('home.attention', { count: summary.attention })} /> : null}
          </View>
        ) : null}
      </HubCard>

      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <Button testID="prepare-export" title={t('hub.export')} icon={FileDown} loading={exporting} onPress={exportPdf} fullWidth />
        <Text variant="caption" color="textSecondary" align="center">
          {t('hub.exportBody')}
        </Text>
      </View>

      {guides.length ? (
        <View>
          <SectionHeader title={t('hub.guides')} style={{ marginTop: space.lg }} />
          <Text variant="footnote" color="textSecondary" style={{ marginBottom: space.sm, paddingHorizontal: space.xs }}>
            {t('hub.guidesBody')}
          </Text>
          <ListGroup>{guides.map((r) => (r ? <ResourceRow key={r.id} resource={r} /> : null))}</ListGroup>
        </View>
      ) : null}

      <Text variant="caption" color="textSecondary" align="center" style={{ marginTop: space.lg }}>
        {t('hub.privacy')}
      </Text>
      {summary.started || data.homeNotes ? (
        <Button title={t('hub.reset')} variant="ghost" size="sm" onPress={confirmReset} style={{ alignSelf: 'center' }} />
      ) : null}
    </Screen>
  );
}
