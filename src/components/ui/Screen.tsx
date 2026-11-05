import type { ReactNode } from 'react';
import { Platform, ScrollView, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space, useTheme } from '@/theme';

import { Text } from './Text';

type Props = ScrollViewProps & {
  children: ReactNode;
  /** Disable scrolling (e.g. full-screen content). */
  static?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Large title drawn in the content (tab roots), with optional trailing actions. */
  title?: string;
  headerRight?: ReactNode;
  /** The stack header is transparent (`headerTransparent`) and the content scrolls behind it. */
  transparentHeader?: boolean;
};

/**
 * Standard screen container. Works with native large-title headers
 * (contentInsetAdjustmentBehavior="automatic") and leaves room for the tab bar.
 */
export function Screen({ children, static: isStatic, padded = true, contentStyle, title, headerRight, transparentHeader, ...rest }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (isStatic) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[{ flex: 1 }, layout.column, padded && { paddingHorizontal: space.gutter }, contentStyle]}>{children}</View>
      </View>
    );
  }
  // iOS native tabs already inset their screens below the status bar.
  const titleTop = (Platform.OS === 'ios' ? 0 : insets.top) + space.md;
  // Native tabs already end the screen above the tab bar (iOS still reports the bar in
  // insets.bottom: 83 pt, so adding it left a ~180 pt gap), and outside tabs iOS' automatic
  // content inset clears the home indicator. Android modals draw under the gesture bar.
  const bottom = (Platform.OS === 'android' ? insets.bottom : 0) + space.xxxl;
  // Behind a transparent header Android draws the content from the top of the window: clear the status bar and the
  // 56 dp header by hand. iOS' automatic content inset already does (in native tabs the screen even starts below the
  // header, so adding the header's height there too left a ~120 pt gap above the content).
  const underHeader = transparentHeader && Platform.OS === 'android' ? insets.top + 56 : 0;
  const top = underHeader ? underHeader + (title ? space.sm : 0) : title ? titleTop : space.sm;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior={title ? 'never' : 'automatic'}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.bg }}
      {...rest}
      contentContainerStyle={[
        layout.column,
        padded && { paddingHorizontal: space.gutter },
        { paddingTop: top, paddingBottom: bottom },
        contentStyle,
      ]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg, gap: space.md }}>
          <Text variant="display" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {headerRight}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}
