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
  // The download button sits beside the row's button, not inside it, so VoiceOver can reach it.
  return (
    <View style={styles.row}>
      <PressableScale
        testID={`resource-${resource.id}`}
        pressedScale={0.99}
        onPress={() => router.push({ pathname: '/library/resource/[id]', params: { id: resource.id } })}
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
            {loc(resource.description)}
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
