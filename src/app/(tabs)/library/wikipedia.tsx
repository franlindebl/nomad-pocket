import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListGroup, Screen, SectionHeader, Text } from '@/components/ui';
import { catalog, getResource, type WikipediaOption } from '@/features/catalog';
import { useOtherLanguage } from '@/features/catalog/editions';
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
  const other = useOtherLanguage();
  const shown = (['es', 'en'] as const).filter((l) => langs.includes(l));
  // A language whose Wikipedia is the same as the app language's goes under "Other languages".
  const isOther = (l: 'es' | 'en') => (catalog.wikipedia[l] ?? []).every((o) => other.has(o.resourceId));
  const main = shown.filter((l) => !isOther(l));
  const others = shown.filter(isOther);
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
      {main.map((lang) => (
        <View key={lang}>
          <SectionHeader title={`${t('wikipedia')} · ${tc(`language.${lang}`)}`} />
          <WikipediaList lang={lang} />
        </View>
      ))}
      {others.length ? (
        <>
          <SectionHeader title={t('otherLanguages')} />
          <Text variant="footnote" color="textSecondary" style={{ marginBottom: space.sm, paddingHorizontal: space.xs }}>
            {t('otherLanguagesBody')}
          </Text>
          {others.map((lang) => (
            <View key={lang} style={{ marginBottom: space.md }}>
              <WikipediaList lang={lang} />
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function WikipediaList({ lang }: { lang: 'es' | 'en' }) {
  return (
    <ListGroup>
      {(catalog.wikipedia[lang] ?? []).map((opt) => (
        <WikipediaRow key={opt.id} option={opt} />
      ))}
    </ListGroup>
  );
}

/** One variant, named by its size option ("Completa (sin imágenes)"); ResourceRow says when a bigger one holds it. */
function WikipediaRow({ option }: { option: WikipediaOption }) {
  const r = getResource(option.resourceId);
  if (!r) return null;
  return <ResourceRow resource={{ ...r, title: option.name, description: option.description }} showIcon={false} />;
}
