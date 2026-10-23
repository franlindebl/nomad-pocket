import { useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, IconBadge, ListGroup, PressableScale, Row, Screen, SectionHeader, Text } from '@/components/ui';
import {
  downloadResource,
  getCategory,
  loc,
  sumMB,
  tierOwnResources,
  tierResources,
  type CatalogCategory,
  type CatalogTier,
} from '@/features/catalog';
import { showDownloadError } from '@/features/catalog/DownloadButton';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { useContent } from '@/features/content/items';
import { useDownloads } from '@/features/downloads/manager';
import { formatBytes, formatMB } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const category = getCategory(slug);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('library');
  const { hue } = useTheme();
  const langs = useSettings((s) => s.contentLanguages);
  const recommended = category?.tiers.find((x) => x.recommended) ?? category?.tiers[0];
  const [tierSlug, setTierSlug] = useState(recommended?.slug);
  if (!category) return null;
  const tier = category.tiers.find((x) => x.slug === tierSlug) ?? category.tiers[0];
  const h = hue(category.hue ?? categoryHue(category.slug));

  return (
    <Screen contentStyle={{ paddingTop: insets.top + 56 }} contentInsetAdjustmentBehavior="never">
      <View style={styles.hero}>
        <IconBadge icon={iconByName(category.icon)} color={h.fg} size={64} />
        <Text variant="display">{loc(category.name)}</Text>
        <Text variant="body" color="textSecondary">
          {loc(category.description)}
        </Text>
      </View>

      <SectionHeader title={t('tiers')} />
      <View style={{ gap: space.md }}>
        {category.tiers.map((x) => (
          <TierCard
            key={x.slug}
            category={category}
            tier={x}
            selected={x.slug === tier.slug}
            onSelect={() => setTierSlug(x.slug)}
            langs={langs}
          />
        ))}
      </View>

      <SectionHeader title={`${t('inThisTier')} · ${loc(tier.name)}`} />
      {tier.includesTier ? (
        <Text variant="footnote" color="textSecondary" style={{ marginBottom: space.sm, paddingHorizontal: space.xs }}>
          {t('tierIncludes', { tier: loc(category.tiers.find((x) => x.slug === tier.includesTier)?.name) })}
        </Text>
      ) : null}
      {tierOwnResources(tier, langs).length ? (
        <ListGroup>
          {tierOwnResources(tier, langs).map((r) => (
            <ResourceRow key={r.id} resource={r} hue={category.hue} />
          ))}
        </ListGroup>
      ) : (
        <Card>
          <Text variant="footnote" color="textSecondary">
            {t('noResultsLang')}
          </Text>
        </Card>
      )}
    </Screen>
  );
}

function TierCard({
  category,
  tier,
  selected,
  onSelect,
  langs,
}: {
  category: CatalogCategory;
  tier: CatalogTier;
  selected: boolean;
  onSelect: () => void;
  langs: string[];
}) {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const items = useContent((s) => s.items);
  const downloads = useDownloads((s) => s.records);
  const resources = tierResources(category, tier, langs);
  const missing = resources.filter((r) => !items.some((i) => i.catalogId === r.id) && !downloads[r.id]);
  const done = resources.length > 0 && resources.every((r) => items.some((i) => i.catalogId === r.id));

  const downloadPack = () => {
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
    <PressableScale
      onPress={onSelect}
      haptic="selection"
      pressedScale={0.99}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.tier,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.ink : colors.border,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <Text variant="title3">{loc(tier.name)}</Text>
          {tier.recommended ? <Badge label={t('recommended')} tone="accent" /> : null}
        </Row>
        <Text variant="headline" tabular>
          {formatMB(sumMB(resources))}
        </Text>
      </Row>
      <Text variant="footnote" color="textSecondary">
        {loc(tier.description)}
      </Text>
      <Text variant="caption" color="textTertiary">
        {t('resources', { count: resources.length })}
      </Text>
      {selected && resources.length ? (
        done ? (
          <Badge label={t('packInstalled')} tone="success" icon={Check} />
        ) : missing.length ? (
          <Button
            title={t('downloadPack', { size: formatMB(sumMB(missing)) })}
            onPress={downloadPack}
            size="md"
            style={{ alignSelf: 'flex-start', marginTop: space.xs }}
          />
        ) : null
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md, paddingTop: space.lg },
  tier: { borderRadius: radius.lg, borderCurve: 'continuous', padding: space.lg, gap: space.sm },
});
