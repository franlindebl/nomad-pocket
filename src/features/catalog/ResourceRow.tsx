import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconBadge, PressableScale, Row, Text } from '@/components/ui';
import { space, type Hue } from '@/theme';

import { categoryHue, categoryIcon } from './icons';
import { DownloadButton, LanguageTag } from './DownloadButton';
import { loc } from './index';
import type { CatalogResource } from './types';

export function ResourceRow({ resource, hue, showIcon = true }: { resource: CatalogResource; hue?: Hue; showIcon?: boolean }) {
  const Icon = categoryIcon(resource.category);
  return (
    <PressableScale
      pressedScale={0.99}
      onPress={() => router.push({ pathname: '/library/resource/[id]', params: { id: resource.id } })}
      style={styles.row}
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
          {loc(resource.description)}
        </Text>
      </View>
      <DownloadButton resource={resource} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
});
