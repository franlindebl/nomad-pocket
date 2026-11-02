// Design tokens ("Precisión": dark only, black and signal yellow). See docs/STYLE_GUIDE.md —
// never hard-code these values in screens.
import { Platform, type TextStyle } from 'react-native';

/** The app has one scheme: dark (app.json `userInterfaceStyle`, owner's decision 2026-11-02). */
export const palette = {
  dark: {
    bg: '#0C0C0C',
    surface: '#131313',
    surfaceAlt: '#1B1B1B',
    surfacePressed: '#242424',
    /** Hairlines, dividers and panel outlines. */
    border: '#232323',
    /** Outlines of controls (icon buttons, chips, inputs): a step brighter than `border`. */
    outline: '#2E2E2E',
    /** The small corner marks of panels (`CornerTicks`). */
    tick: '#5A5A5A',
    text: '#F2F2EF',
    /** Greys are for secondary text only (subtitles, metadata, placeholders, chevrons). Titles, labels of
     *  actions and anything someone taps to act use `text` (or the accent): never grey. */
    textSecondary: '#8F8F89',
    textTertiary: '#5F5F5A',
    /** Decorative marks only (a separator, an "off" dot), never text someone has to read. */
    faint: '#4A4A46',
    /** Fill of the strongest controls (send, selected chip): signal yellow. */
    ink: '#FFD60A',
    onInk: '#0C0C0C',
    /** Signal yellow: progress, active state, the one primary action. Works as fill and as text. */
    accent: '#FFD60A',
    accentSoft: '#2B2507',
    onAccent: '#0C0C0C',
    success: '#3DD68C',
    successSoft: '#0E2A1D',
    warning: '#FF9F0A',
    warningSoft: '#33220A',
    danger: '#FF453A',
    dangerSoft: '#3A1513',
    /** The user's position on the map (puck + compass beam: scripts/maps/make-beam.py). */
    location: '#4C8DF6',
    /** The reader's optional paper page (dark text on cream); the same cream is in ZimWebView's paper CSS. */
    paper: '#F2E6CE',
    /** A speed limit sign: white, red ring, black figures, like the real one. */
    signFace: '#FFFFFF',
    signRing: '#D93D42',
    signText: '#18171B',
    overlay: 'rgba(0,0,0,0.6)',
    shadow: 'rgba(0,0,0,0.5)',
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type ColorToken = keyof (typeof palette)['dark'];
export type Colors = { [K in ColorToken]: string };

/** Category hues: icon strokes and subtle tints only, never large fills. Tuned to read on black. */
export const hues = {
  medicine: '#FF6B6B',
  survival: '#FFD60A',
  education: '#8AA4FF',
  diy: '#3DD6C3',
  agriculture: '#86D96B',
  computing: '#B992FF',
  reference: '#5DB4FF',
  maps: '#4FD1A5',
  ai: '#F2F2EF',
  courses: '#8AA4FF',
  neutral: '#8F8F89',
} as const;

export type Hue = keyof typeof hues;

/** Hue at 16% opacity, for tint backgrounds. */
export function tint(hex: string): string {
  return `${hex}29`;
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

/** Square by design: corners are 0 and the important ones are cut (`Chamfer`), not rounded. */
export const radius = {
  sm: 2,
  md: 2,
  lg: 0,
  xl: 0,
  pill: 999,
} as const;

/** The diagonal cut of chamfered corners (`Chamfer`): small controls / big blocks. */
export const chamfer = { sm: 7, md: 10, lg: 16 } as const;

/** Text font (IBM Plex Sans). Display and labels use their own families through `typography`. */
export const fontFamily = Platform.select({ web: "'IBM Plex Sans', system-ui, sans-serif", default: 'IBM Plex Sans' });
/** Titles, figures and button labels: Chakra Petch (its letters already have cut corners). */
export const displayFamily = Platform.select({ web: "'Chakra Petch', system-ui, sans-serif", default: 'Chakra Petch' });
/** Labels, sizes and code: IBM Plex Mono. */
export const monoFamily = Platform.select({ web: "'IBM Plex Mono', ui-monospace, monospace", default: 'IBM Plex Mono' });

type Variant = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing' | 'textTransform'>;

export const typography = {
  display: { fontFamily: displayFamily, fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  title1: { fontFamily: displayFamily, fontSize: 25, lineHeight: 30, fontWeight: '700', letterSpacing: 0 },
  title2: { fontFamily: displayFamily, fontSize: 21, lineHeight: 26, fontWeight: '600', letterSpacing: 0 },
  title3: { fontFamily: displayFamily, fontSize: 18, lineHeight: 23, fontWeight: '600', letterSpacing: 0 },
  headline: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontFamily, fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  callout: { fontFamily, fontSize: 15, lineHeight: 21, fontWeight: '500', letterSpacing: 0 },
  footnote: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  caption: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
  overline: { fontFamily: monoFamily, fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 1.3, textTransform: 'uppercase' },
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
