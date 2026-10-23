import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { fontFamily, typography, useTheme, type ColorToken, type TypographyVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: ColorToken;
  /** Raw color override, e.g. a category hue. Prefer `color`. */
  tint?: string;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
  tabular?: boolean;
};

export function Text({ variant = 'body', color = 'text', tint, align, weight, tabular, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        { fontFamily, color: tint ?? colors[color] },
        typography[variant],
        align && { textAlign: align },
        weight && { fontWeight: weight },
        tabular && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}
