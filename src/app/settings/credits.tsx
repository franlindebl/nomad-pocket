import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Code, Package, Scale } from 'lucide-react-native';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { IconBadge, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { creditKey, creditSubtitle, getCredits, SOURCE_URL, type Credit, type CreditKind } from '@/features/credits/licenses';
import { space } from '@/theme';

/** Settings › Credits & licenses: the app's GPL notice, where its source is, and every bundled component. */
export default function CreditsScreen() {
  const { t } = useTranslation('settings');
  const credits = getCredits();
  const open = (kind: CreditKind, id: string) => router.push({ pathname: '/settings/license', params: { id: creditKey(kind, id) } });

  const group = (kind: CreditKind, list: Credit[]) => (
    <ListGroup>
      {list.map((c) => (
        <ListRow key={c.id} title={c.name} subtitle={creditSubtitle(c)} chevron onPress={() => open(kind, c.id)} />
      ))}
    </ListGroup>
  );

  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.sm }}>
        <Text variant="headline">{credits.app.name}</Text>
        {credits.app.copyright?.map((line) => (
          <Text key={line} variant="footnote" color="textSecondary">
            {line}
          </Text>
        ))}
        <Text variant="footnote" color="textSecondary">
          {t('creditsIntro')}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {t('creditsWarranty')}
        </Text>
      </View>
      <ListGroup style={{ marginTop: space.lg }}>
        <ListRow
          testID="credits-source"
          title={t('creditsSource')}
          subtitle={SOURCE_URL.replace('https://', '')}
          leading={<IconBadge icon={Code} hue="reference" size={36} />}
          chevron
          onPress={() => WebBrowser.openBrowserAsync(SOURCE_URL)}
        />
        <ListRow
          testID="credits-gpl"
          title={t('creditsLicense')}
          subtitle={credits.app.license}
          leading={<IconBadge icon={Scale} hue="reference" size={36} />}
          chevron
          onPress={() => open('app', credits.app.id)}
        />
      </ListGroup>
      <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }}>
        {t('creditsSourceNote')}
      </Text>

      <SectionHeader title={t('creditsData')} />
      {group('data', credits.data)}

      <SectionHeader title={t('creditsNative')} />
      {group('native', credits.native)}

      <SectionHeader title={t('creditsJs')} />
      <ListGroup>
        <ListRow
          testID="credits-js"
          title={t('creditsJs')}
          subtitle={t('creditsJsCount', { count: credits.js.length })}
          leading={<IconBadge icon={Package} hue="neutral" size={36} />}
          chevron
          onPress={() => router.push('/settings/packages')}
        />
      </ListGroup>
    </Screen>
  );
}
