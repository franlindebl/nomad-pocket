import { hues, palette, tint, type ColorScheme, type Colors, type Hue } from './tokens';

export * from './tokens';

export type Theme = {
  scheme: ColorScheme;
  colors: Colors;
  hue: (h: Hue) => { fg: string; bg: string };
};

const THEME: Theme = {
  scheme: 'dark',
  colors: palette.dark,
  hue: (h) => ({ fg: hues[h], bg: tint(hues[h]) }),
};

/** The app is dark only: one fixed theme (kept as a hook so screens don't care). */
export function useTheme(): Theme {
  return THEME;
}
