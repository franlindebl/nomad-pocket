// A collection (Medicine, Survival…): every level with everything it adds, one after another, so the
// whole catalog of the topic is on one screen and what's missing shows (owner's decision, 2026-11-02;
// before, the levels were cards you selected and the list below showed only the selected one). Each
// level downloads only its own resources. Then the same works in other languages, then the archives on
// the phone that no level lists (imports, a language the person no longer reads).
import { useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, IconBadge, ListGroup, Row, Screen, SectionHeader, Text } from '@/components/ui';
import {
  downloadResource,
  getCategory,
  loc,
  sumMB,
  tierOwnResources,
  tierResources,
  type CatalogCategory,
  type CatalogResource,
  type CatalogTier,
} from '@/features/catalog';
import { showDownloadError } from '@/features/catalog/DownloadButton';
import { withoutHeld } from '@/features/catalog/editions-core';
import { hasOrHeld, splitByLanguage, useOtherLanguage } from '@/features/catalog/editions';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { useContent } from '@/features/content/items';
import { useDownloads } from '@/features/downloads/manager';
import { useCollections } from '@/features/library/collections';
import { showArchiveActions } from '@/features/library/archive-actions';
import { ArchiveRow } from '@/features/library/components/ArchiveRow';
import { CollectionCount } from '@/features/library/components/CollectionCount';
import { useUpdates } from '@/features/updates/updates';
import { formatBytes, formatMB } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const category = getCategory(slug);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('library');
  const { hue } = useTheme();
  const langs = useSettings((s) => s.contentLanguages);
  const collection = useCollections().find((c) => c.key === slug);
  const other = useOtherLanguage();
  const items = useContent((s) => s.items);
  const updates = useUpdates();
  if (!category) return null;
  const h = hue(category.hue ?? categoryHue(category.slug));
  const all = tierResources(category, category.tiers[category.tiers.length - 1], langs);
  const [, otherLanguages] = splitByLanguage(all, other);
  const listed = new Set(all.map((r) => r.id));
  const unlisted = collection?.members.filter((m) => !listed.has(m.catalogId ?? m.id)) ?? [];
  // Installed archives a newer edition replaces: their rows say so (the Library's archive rows did).
  const outdated = new Set(
    updates
      .filter((u) => u.kind === 'zim' && !u.inFlight)
      .map((u) => items.find((i) => i.id === u.itemId)?.catalogId)
      .filter(Boolean),
  );
  const row = (r: CatalogResource) => {
    const item = items.find((i) => i.catalogId === r.id);
    return (
      <ResourceRow
        key={r.id}
        resource={r}
        hue={category.hue}
        outdated={outdated.has(r.id)}
        onLongPress={item ? () => showArchiveActions(item) : undefined}
      />
    );
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + 56 }} contentInsetAdjustmentBehavior="never">
      <View style={styles.hero}>
        <IconBadge icon={iconByName(category.icon)} color={h.fg} size={64} />
        <Text variant="display">{loc(category.name)}</Text>
        <Text variant="body" color="textSecondary">
          {loc(category.description)}
        </Text>
        {collection ? <CollectionCount collection={collection} /> : null}
      </View>

      {category.tiers.map((tier, i) => (
        <Level
          key={tier.slug}
          category={category}
          tier={tier}
          n={i + 1}
          resources={splitByLanguage(tierOwnResources(tier, langs), other)[0]}
          row={row}
        />
      ))}

      {otherLanguages.length ? (
        <>
          <SectionHeader title={t('otherLanguages')} />
          <Text variant="footnote" color="textSecondary" style={styles.note}>
            {t('otherLanguagesBody')}
          </Text>
          <ListGroup>{otherLanguages.map(row)}</ListGroup>
        </>
      ) : null}

      {unlisted.length ? (
        <>
          <SectionHeader title={t('alsoOnDevice')} />
          <ListGroup>
            {unlisted.map((item) => (
              <ArchiveRow key={item.id} item={item} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </Screen>
  );
}

/** One level: what it adds, how many of those you have, and a button that downloads the missing ones. */
function Level({
  category,
  tier,
  n,
  resources,
  row,
}: {
  category: CatalogCategory;
  tier: CatalogTier;
  n: number;
  /** The level's own resources in the person's languages, without the same works in another language. */
  resources: CatalogResource[];
  row: (r: CatalogResource) => ReactNode;
}) {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const items = useContent((s) => s.items);
  const downloads = useDownloads((s) => s.records);
  // An edition a bigger installed one holds counts as had (the text-only Wikibooks next to the one with images).
  const have = resources.filter((r) => hasOrHeld(items, r.id)).length;
  const done = resources.length > 0 && have === resources.length;
  // What the button downloads: no edition another one in the level holds.
  const pack = withoutHeld(resources);
  // A failed or cancelled record doesn't make a resource "handled": enqueueDownload takes it again.
  const inFlight = (id: string) => {
    const status = downloads[id]?.status;
    return !!status && status !== 'failed' && status !== 'cancelled';
  };
  const missing = pack.filter((r) => !hasOrHeld(items, r.id) && !inFlight(r.id));

  const download = () => {
    const size = sumMB(missing) * 1e6;
    Alert.alert(
      t('packConfirmTitle', { name: `${loc(category.name)} · ${loc(tier.name)}` }),
      t('packConfirmBody', { count: missing.length, size: formatBytes(size), free: formatBytes(freeBytes()) }),
      [
        { text: tc('actions.cancel'), style: 'cancel' },
        {
          text: tc('actions.download'),
          onPress: () => {
            const go = async () => {
              for (const r of missing) {
                try {
                  await downloadResource(r);
                } catch (e) {
                  showDownloadError(e, tc, go);
                  return;
                }
              }
            };
            go();
          },
        },
      ],
    );
  };

  return (
    <>
      <SectionHeader title={`${t('level', { n })} · ${loc(tier.name)}`} />
      <View style={styles.intro}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            {tier.recommended ? <Badge label={t('recommended')} tone="accent" /> : null}
            {resources.length ? (
              <Text variant="footnote" color={have ? 'text' : 'textSecondary'} tabular>
                {t('levelHave', { have, total: resources.length })}
              </Text>
            ) : null}
          </Row>
          {pack.length ? (
            <Text variant="headline" tabular>
              {formatMB(sumMB(pack))}
            </Text>
          ) : null}
        </Row>
        <Text variant="footnote" color="textSecondary">
          {loc(tier.description)}
        </Text>
        {done ? (
          <View style={styles.action}>
            <Badge label={t('levelDone')} tone="success" icon={Check} />
          </View>
        ) : missing.length ? (
          <View style={styles.action}>
            <Button
              testID={`pack-download-${tier.slug}`}
              title={t('downloadLevel', { size: formatMB(sumMB(missing)) })}
              onPress={download}
              size="md"
            />
          </View>
        ) : null}
      </View>
      {resources.length ? (
        <ListGroup>{resources.map(row)}</ListGroup>
      ) : (
        <Card>
          <Text variant="footnote" color="textSecondary">
            {t('noResultsLang')}
          </Text>
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md, paddingTop: space.lg },
  intro: { gap: space.sm, paddingHorizontal: space.xs, marginBottom: space.md },
  action: { alignItems: 'flex-start', paddingTop: space.xs },
  note: { marginBottom: space.sm, paddingHorizontal: space.xs },
});
