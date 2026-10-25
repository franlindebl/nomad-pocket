// Design tokens. See docs/STYLE_GUIDE.md — never hard-code these values in screens.
import { Platform, type TextStyle } from 'react-native';

export const palette = {
  light: {
    bg: '#F6F5F2',
    surface: '#FFFFFF',
    surfaceAlt: '#EEECE7',
    surfacePressed: '#E6E3DD',
    border: '#E3E0D9',
    text: '#18171B',
    textSecondary: '#6A6760',
    textTertiary: '#9B978E',
    ink: '#18171B',
    onInk: '#FFFFFF',
    accent: '#F2643A',
    accentSoft: '#FDE7DF',
    onAccent: '#FFFFFF',
    success: '#2F9E5B',
    successSoft: '#DDF3E5',
    warning: '#D68A00',
    warningSoft: '#FCEFD3',
    danger: '#D93D42',
    dangerSoft: '#FBE1E1',
    /** The user's position on the map (puck + compass beam: scripts/maps/make-beam.py). */
    location: '#1A73E8',
    overlay: 'rgba(24,23,27,0.45)',
    shadow: 'rgba(24,23,27,0.12)',
  },
  dark: {
    bg: '#0D0D0F',
    surface: '#17171A',
    surfaceAlt: '#202024',
    surfacePressed: '#28282D',
    border: '#2A2A30',
    text: '#F4F3EF',
    textSecondary: '#A3A09A',
    textTertiary: '#6E6B66',
    ink: '#F4F3EF',
    onInk: '#0D0D0F',
    accent: '#FF7A4F',
    accentSoft: '#3A1F17',
    onAccent: '#FFFFFF',
    success: '#46C47A',
    successSoft: '#12301F',
    warning: '#F5B02E',
    warningSoft: '#33260C',
    danger: '#FF6369',
    dangerSoft: '#3A1517',
    location: '#4C8DF6',
    overlay: 'rgba(0,0,0,0.6)',
    shadow: 'rgba(0,0,0,0.5)',
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type ColorToken = keyof (typeof palette)['light'];
export type Colors = { [K in ColorToken]: string };

export const hues = {
  medicine: '#E5484D',
  survival: '#F76B15',
  education: '#3E63DD',
  diy: '#12A594',
  agriculture: '#46A758',
  computing: '#8E4EC6',
  reference: '#0090FF',
  maps: '#0B8A8A',
  ai: '#7C5CFF',
  courses: '#3E63DD',
  neutral: '#6A6760',
} as const;

export type Hue = keyof typeof hues;

/** Hue at 12% (light) / 20% (dark) opacity, for icon badge and tint backgrounds. */
export function tint(hex: string, scheme: ColorScheme): string {
  const alpha = scheme === 'dark' ? '33' : '1F';
  return `${hex}${alpha}`;
}

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  gutter: 20,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const fontFamily = Platform.select({ web: 'Inter, system-ui, sans-serif', default: 'Inter' });

type Variant = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing' | 'textTransform'>;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.6 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  title3: { fontSize: 19, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '500', letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
} satisfies Record<string, Variant>;

export type TypographyVariant = keyof typeof typography;

export const motion = {
  press: 120,
  state: 220,
  screen: 320,
  spring: { damping: 18, stiffness: 220 },
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Content column on wide screens (iPad): full width up to this, then centred. */
export const layout = {
  maxContentWidth: 720,
  /** Spread into a container's style to centre it within that width. */
  column: { width: '100%', maxWidth: 720, alignSelf: 'center' },
} as const;
