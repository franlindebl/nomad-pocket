import type { LucideIcon } from 'lucide-react-native';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { hues, useTheme, type Hue } from '@/theme';

type Props = {
  icon: LucideIcon;
  hue?: Hue;
  /** Raw color; overrides hue. */
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/** Category icon in a square outline (40×40 by default): the hue colours the stroke only. */
export function IconBadge({ icon: Icon, hue = 'neutral', color, size = 40, style }: Props) {
  const { colors } = useTheme();
  const fg = color ?? hues[hue];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderWidth: 1,
          borderColor: colors.outline,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Icon size={Math.round(size * 0.48)} color={fg} strokeWidth={size >= 48 ? 1.6 : 1.9} />
    </View>
  );
}
