// Home entry point to Preparedness: what is done and what needs attention.
import { router } from 'expo-router';
import { ChevronRight, ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Badge, Card, IconBadge, ProgressBar, Row, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { useKitGroups } from './rows';

export function PrepareHomeCard() {
  const { t } = useTranslation('prepare');
  const { colors } = useTheme();
  const { summary } = useKitGroups();
  const parts = [
    summary.done ? t('home.kit', { done: summary.done, total: summary.total }) : '',
    summary.contacts ? t('home.contacts', { count: summary.contacts }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const body = summary.started && parts ? parts : t('home.empty');

  return (
    <Card
      testID="open-prepare"
      style={{ marginTop: space.md, gap: space.md }}
      onPress={() => router.push('/prepare')}
      accessibilityLabel={[t('home.title'), body, summary.attention ? t('home.attention', { count: summary.attention }) : '']
        .filter(Boolean)
        .join(', ')}>
      <Row gap={space.md}>
        <IconBadge icon={ShieldCheck} hue="survival" size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{t('home.title')}</Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {body}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </Row>
      {summary.done ? <ProgressBar value={summary.total ? summary.done / summary.total : 0} /> : null}
      {summary.attention ? <Badge tone="warning" label={t('home.attention', { count: summary.attention })} /> : null}
    </Card>
  );
}
