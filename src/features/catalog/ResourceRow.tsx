import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconBadge, PressableScale, Row, Text } from '@/components/ui';
import { space, useTheme, type Hue } from '@/theme';

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
  const { colors } = useTheme();
  const [buttonWidth, setButtonWidth] = useState(96);
  const Icon = categoryIcon(resource.category);
  // A bigger edition on the phone already holds this one: say which instead of what it is.
  const covering = useCovering(resource.id);
  const about = covering ? t('included.in', { name: covering.name }) : loc(resource.description);
  const description = outdated ? `${t('updates:available')} · ${about}` : about;
  // The title runs to the end of the row (two lines: "Tratamiento del a…" said nothing). The download button shares
  // the description's line: it sits over the row, beside its button rather than inside it so VoiceOver can reach it,
  // and the description leaves room for it (measured: "↓ 1,2 GB", "Abrir" and "Incluida" differ in width).
  return (
    <View>
      <PressableScale
        testID={`resource-${resource.id}`}
        pressedScale={0.99}
        onPress={() => router.push({ pathname: '/library/resource/[id]', params: { id: resource.id } })}
        onLongPress={onLongPress}
        style={styles.body}
        accessibilityRole="button">
        {showIcon ? (
          <View style={styles.icon}>
            <IconBadge icon={Icon} hue={hue ?? categoryHue(resource.category)} size={ICON} />
            <LanguageTag language={resource.language} style={[styles.iconTag, { backgroundColor: colors.surface }]} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 3 }}>
          <Row gap={6} style={{ alignItems: 'flex-start' }}>
            <Text variant="headline" numberOfLines={2} style={{ flexShrink: 1 }}>
              {loc(resource.title)}
            </Text>
            {showIcon ? null : <LanguageTag language={resource.language} style={{ marginTop: 2 }} />}
          </Row>
          <View style={[styles.about, { paddingRight: buttonWidth + space.md }]}>
            <Text variant="footnote" color="textSecondary" numberOfLines={2}>
              {description}
            </Text>
          </View>
        </View>
      </PressableScale>
      <View style={styles.button} onLayout={(e) => setButtonWidth(Math.ceil(e.nativeEvent.layout.width))}>
        <DownloadButton resource={resource} />
      </View>
    </View>
  );
}

const ICON = 40;
// The tallest button (the download pill): the description's line is at least this tall so the button never reaches
// the title above it.
const BUTTON = 32;

const styles = StyleSheet.create({
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  icon: { alignItems: 'center' },
  iconTag: { marginTop: -9 },
  about: { minHeight: BUTTON, justifyContent: 'center' },
  button: { position: 'absolute', right: space.lg, bottom: space.md, height: BUTTON, justifyContent: 'center' },
});
