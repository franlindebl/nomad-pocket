import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { creditSubtitle, findCredit, getCredits, textBlocks } from '@/features/credits/licenses';
import { space, useTheme } from '@/theme';

/** One credit: copyright lines, where its source is, and the licence text as shipped (not translated). */
export default function LicenseScreen() {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const credits = getCredits();
  const credit = id ? findCredit(credits, id) : undefined;
  const blocks = useMemo(() => (credit?.text != null ? textBlocks(credits.texts[credit.text]) : []), [credit, credits]);

  if (!credit) return <Stack.Screen options={{ title: '' }} />;
  const url = credit.url;
  return (
    <Screen>
      <Stack.Screen options={{ title: credit.name }} />
      <View style={{ gap: space.xs, paddingTop: space.sm }}>
        <Text variant="headline">{creditSubtitle(credit)}</Text>
        {credit.copyright?.map((line) => (
          <Text key={line} variant="footnote" color="textSecondary" selectable>
            {line}
          </Text>
        ))}
        {credit.note ? (
          <Text variant="footnote" color="textSecondary" selectable style={{ marginTop: space.xs }}>
            {credit.note}
          </Text>
        ) : null}
      </View>
      {url ? (
        <ListGroup style={{ marginTop: space.lg }}>
          <ListRow
            title={t('creditsOpenSource')}
            subtitle={url.replace(/^https?:\/\//, '')}
            subtitleLines={1}
            trailing={<ExternalLink size={18} color={colors.textTertiary} />}
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(url)}
          />
        </ListGroup>
      ) : null}
      <SectionHeader title={t('creditsText')} />
      {credit.standard ? (
        <Text variant="footnote" color="textSecondary" style={{ marginBottom: space.sm }}>
          {t('creditsStandardText')}
        </Text>
      ) : null}
      {blocks.length ? (
        <Card>
          {blocks.map((block, i) => (
            <Text key={i} variant="footnote" selectable style={i > 0 ? { marginTop: space.md } : undefined}>
              {block}
            </Text>
          ))}
        </Card>
      ) : (
        <Text variant="footnote" color="textSecondary">
          {t('creditsNoText')}
        </Text>
      )}
    </Screen>
  );
}
