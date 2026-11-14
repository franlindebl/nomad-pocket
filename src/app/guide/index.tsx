import { router } from 'expo-router';
import { SearchX, Tent } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Badge, EmptyState, IconBadge, ListGroup, ListRow, Screen, SearchField, SectionHeader, Text } from '@/components/ui';
import { guideCards, guideIndex } from '@/features/guide/guide';
import { GUIDE_SECTIONS, type GuideCard } from '@/features/guide/guide-core';
import { space } from '@/theme';

/**
 * The emergency guide: its cards by section, or the ones matching a search. Ends with the way to the Library's
 * survival archives (on Android, Home's "Survival guides" opens this screen: it works with nothing downloaded).
 */
export default function GuideScreen() {
  const { t, i18n } = useTranslation('guide');
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const [query, setQuery] = useState('');
  const cards = guideCards();
  const results = useMemo(() => (query.trim() ? guideIndex(lang).match(query, 30).map((m) => m.card) : null), [query, lang]);

  const row = (c: GuideCard) => (
    <ListRow
      key={c.id}
      testID={`guide-card-${c.id}`}
      title={c[lang].title}
      titleLines={2}
      trailing={c.vital ? <Badge label={t('vital')} tone="danger" /> : undefined}
      chevron
      onPress={() => router.push({ pathname: '/guide/[id]', params: { id: c.id } })}
    />
  );

  return (
    <Screen>
      <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('search')} testID="guide-search" />
      {results ? (
        results.length ? (
          <ListGroup style={{ marginTop: space.lg }}>{results.map(row)}</ListGroup>
        ) : (
          <EmptyState icon={SearchX} title={t('empty')} />
        )
      ) : (
        <View>
          <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }}>
            {t('intro')}
          </Text>
          {GUIDE_SECTIONS.map((s) => {
            const inSection = cards.filter((c) => c.section === s);
            if (!inSection.length) return null;
            return (
              <View key={s}>
                <SectionHeader title={t(`sections.${s}`)} />
                <ListGroup>{inSection.map(row)}</ListGroup>
              </View>
            );
          })}
          <ListGroup style={{ marginTop: space.xl }}>
            <ListRow
              testID="guide-more-library"
              leading={<IconBadge icon={Tent} hue="survival" size={36} />}
              title={t('moreLibrary')}
              subtitle={t('moreLibraryBody')}
              subtitleLines={2}
              chevron
              onPress={() => router.navigate({ pathname: '/library/category/[slug]', params: { slug: 'survival' } })}
            />
          </ListGroup>
        </View>
      )}
    </Screen>
  );
}
