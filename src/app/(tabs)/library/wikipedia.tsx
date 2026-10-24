import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListGroup, Screen, SectionHeader, Text } from '@/components/ui';
import { catalog, getResource } from '@/features/catalog';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

export default function WikipediaScreen() {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const langs = useSettings((s) => s.contentLanguages);
  return (
    <Screen>
      <View style={{ gap: space.xs, paddingTop: space.md }}>
        <Text variant="title2">{t('wikipediaPick')}</Text>
        <Text variant="callout" color="textSecondary">
          {t('wikipediaPickBody')}
        </Text>
      </View>
      {(['es', 'en'] as const)
        .filter((l) => langs.includes(l))
        .map((lang) => (
          <View key={lang}>
            <SectionHeader title={`${t('wikipedia')} · ${tc(`language.${lang}`)}`} />
            <ListGroup>
              {(catalog.wikipedia[lang] ?? []).map((opt) => {
                const r = getResource(opt.resourceId);
                if (!r) return null;
                return <ResourceRow key={opt.id} resource={{ ...r, title: opt.name, description: opt.description }} showIcon={false} />;
              })}
            </ListGroup>
          </View>
        ))}
    </Screen>
  );
}
