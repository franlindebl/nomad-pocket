import { useColorScheme } from 'react-native';

import { hues, palette, tint, type ColorScheme, type Colors, type Hue } from './tokens';

export * from './tokens';

export type Theme = {
  scheme: ColorScheme;
  colors: Colors;
  hue: (h: Hue) => { fg: string; bg: string };
};

export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    colors: palette[scheme],
    hue: (h) => ({ fg: hues[h], bg: tint(hues[h], scheme) }),
  };
}
