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

/** Category icon in a rounded tinted square (40×40 by default). */
export function IconBadge({ icon: Icon, hue = 'neutral', color, size = 40, style }: Props) {
  const { scheme } = useTheme();
  const fg = color ?? hues[hue];
  const bg = `${fg}${scheme === 'dark' ? '33' : '1F'}`;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          borderCurve: 'continuous',
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Icon size={Math.round(size * 0.5)} color={fg} strokeWidth={size >= 48 ? 1.75 : 2} />
    </View>
  );
}
