// "© OpenStreetMap contributors" over the map when it first shows. MapLibre Native
// only draws an (i) button for the credits, so the map never showed them unless that
// was tapped. OSMF's attribution guidelines want the credit seen without interacting,
// and let it fold away after about five seconds or the first gesture; the (i) keeps
// the full credits (OpenStreetMap, Protomaps) after that.
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

/** How long the credit stays when nobody touches the map. */
export const CREDIT_MS = 5000;

export function MapCredit({ top }: { top: number }) {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  return (
    <Animated.View
      exiting={FadeOut.duration(400)}
      pointerEvents="none"
      testID="map-credit"
      style={[styles.pill, { top, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {t('credit')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
