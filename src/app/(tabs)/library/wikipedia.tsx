import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListGroup, Screen, SectionHeader, Text } from '@/components/ui';
import { catalog, getResource, loc, type WikipediaOption } from '@/features/catalog';
import { useCoveringWikipedia } from '@/features/catalog/DownloadButton';
import { useCollections } from '@/features/library/collections';
import { WIKIPEDIA } from '@/features/library/collections-core';
import { ArchiveRow } from '@/features/library/components/ArchiveRow';
import { CollectionCount } from '@/features/library/components/CollectionCount';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

export default function WikipediaScreen() {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const langs = useSettings((s) => s.contentLanguages);
  const collection = useCollections().find((c) => c.key === WIKIPEDIA);
  return (
    <Screen>
      <View style={{ gap: space.xs, paddingTop: space.md }}>
        <Text variant="title2">{t('wikipediaPick')}</Text>
        <Text variant="callout" color="textSecondary">
          {t('wikipediaPickBody')}
        </Text>
        {collection ? <CollectionCount collection={collection} /> : null}
      </View>
      {collection?.members.length ? (
        <>
          <SectionHeader title={t('onDevice')} />
          <ListGroup>
            {collection.members.map((item) => (
              <ArchiveRow key={item.id} item={item} />
            ))}
          </ListGroup>
        </>
      ) : null}
      {(['es', 'en'] as const)
        .filter((l) => langs.includes(l))
        .map((lang) => (
          <View key={lang}>
            <SectionHeader title={`${t('wikipedia')} · ${tc(`language.${lang}`)}`} />
            <ListGroup>
              {(catalog.wikipedia[lang] ?? []).map((opt) => (
                <WikipediaRow key={opt.id} option={opt} />
              ))}
            </ListGroup>
          </View>
        ))}
    </Screen>
  );
}

/** One variant. When a bigger one already installed holds it, the row says which instead of what it is. */
function WikipediaRow({ option }: { option: WikipediaOption }) {
  const { t } = useTranslation();
  const covering = useCoveringWikipedia(option.resourceId);
  const r = getResource(option.resourceId);
  if (!r) return null;
  const note = covering ? t('wikipedia.includedIn', { name: loc(covering.option.name) }) : null;
  const description = note ? { es: note, en: note } : option.description;
  return <ResourceRow resource={{ ...r, title: option.name, description }} showIcon={false} />;
}
