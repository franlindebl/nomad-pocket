import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconBadge, PressableScale, Row, Text } from '@/components/ui';
import { space, type Hue } from '@/theme';

import { categoryHue, categoryIcon } from './icons';
import { DownloadButton, LanguageTag } from './DownloadButton';
import { useCovering } from './editions';
import { loc } from './index';
import type { CatalogResource } from './types';

export function ResourceRow({
  resource,
  hue,
  showIcon = true,
  outdated = false,
  onLongPress,
}: {
  resource: CatalogResource;
  hue?: Hue;
  showIcon?: boolean;
  /** Installed, and a newer edition is out: say so first. */
  outdated?: boolean;
  /** The installed archive's menu (share, delete), as the Library's archive rows have it. */
  onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = categoryIcon(resource.category);
  // A bigger edition on the phone already holds this one: say which instead of what it is.
  const covering = useCovering(resource.id);
  const about = covering ? t('included.in', { name: covering.name }) : loc(resource.description);
  const description = outdated ? `${t('updates:available')} · ${about}` : about;
  // The download button sits beside the row's button, not inside it, so VoiceOver can reach it.
  return (
    <View style={styles.row}>
      <PressableScale
        testID={`resource-${resource.id}`}
        pressedScale={0.99}
        onPress={() => router.push({ pathname: '/library/resource/[id]', params: { id: resource.id } })}
        onLongPress={onLongPress}
        style={styles.body}
        accessibilityRole="button">
        {showIcon ? <IconBadge icon={Icon} hue={hue ?? categoryHue(resource.category)} size={40} /> : null}
        <View style={{ flex: 1, gap: 3 }}>
          <Row gap={6}>
            <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
              {loc(resource.title)}
            </Text>
            <LanguageTag language={resource.language} />
          </Row>
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {description}
          </Text>
        </View>
      </PressableScale>
      <DownloadButton resource={resource} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: space.lg },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingVertical: space.md },
});
