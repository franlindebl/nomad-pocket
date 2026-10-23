import { FileText, TextSearch } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

import type { ZimSearchHit } from '../zim';

/** One search result: title, optional snippet. */
export function HitRow({ hit, onPress }: { hit: ZimSearchHit; onPress: () => void }) {
  const { colors } = useTheme();
  const Icon = hit.snippet ? TextSearch : FileText;
  return (
    <PressableScale onPress={onPress} pressedScale={0.99} accessibilityRole="button" style={styles.row}>
      <Icon size={18} color={colors.textTertiary} style={{ marginTop: 2 }} />
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={2}>
          {hit.title || hit.path}
        </Text>
        {hit.snippet ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={3}>
            {hit.snippet}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 48 },
  body: { flex: 1, gap: 2 },
});
