import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

type Props = ScrollViewProps & {
  children: ReactNode;
  /** Disable scrolling (e.g. full-screen content). */
  static?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Standard screen container. Works with native large-title headers
 * (contentInsetAdjustmentBehavior="automatic") and leaves room for the tab bar.
 */
export function Screen({ children, static: isStatic, padded = true, contentStyle, ...rest }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (isStatic) {
    return <View style={[{ flex: 1, backgroundColor: colors.bg }, padded && { paddingHorizontal: space.gutter }, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.bg }}
      {...rest}
      contentContainerStyle={[
        padded && { paddingHorizontal: space.gutter },
        { paddingTop: space.sm, paddingBottom: insets.bottom + 96 },
        contentStyle,
      ]}>
      {children}
    </ScrollView>
  );
}
