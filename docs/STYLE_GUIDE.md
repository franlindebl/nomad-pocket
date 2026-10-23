# Nomad Pocket — Style Guide

> "El conocimiento que nunca se desconecta." / "Knowledge that never goes offline."

Nomad Pocket is field gear, not a toy. The interface should feel **calm, capable and
trustworthy**: quiet surfaces, confident typography, one warm accent that signals
action and progress. Think "a well-made expedition notebook" rendered with modern
native polish (iOS 26 / Material 3), never skeuomorphic, never cluttered.

All tokens live in `src/theme/tokens.ts`. Never hard-code a color, size or radius in
a screen — use the theme.

---

## 1. Principles

1. **Content first.** Chrome recedes; articles, maps and answers take the screen.
2. **One accent.** *Ember* is reserved for progress, active state and the single most
   important action on a screen. Everything else is ink on paper.
3. **Honest about size.** Every downloadable thing shows its size and what it costs
   in free storage *before* the user commits.
4. **Works in the dark — literally.** Dark mode is a first-class citizen (night use,
   battery). Both themes are designed, not inverted.
5. **Offline is the normal state.** No spinners waiting on a network that isn't there;
   explain clearly when something needs a connection.
6. **Touch-friendly.** Minimum hit target 44×44 pt; primary actions in thumb reach.

## 2. Color

Warm neutrals ("paper" and "ink") with a single brand accent.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F6F5F2` | `#0D0D0F` | Screen background |
| `surface` | `#FFFFFF` | `#17171A` | Cards, sheets, rows |
| `surfaceAlt` | `#EEECE7` | `#202024` | Inputs, segmented controls, skeletons |
| `border` | `#E3E0D9` | `#2A2A30` | Hairlines, card outlines |
| `text` | `#18171B` | `#F4F3EF` | Primary text |
| `textSecondary` | `#6A6760` | `#A3A09A` | Secondary text, metadata |
| `textTertiary` | `#9B978E` | `#6E6B66` | Placeholders, disabled |
| `ink` | `#18171B` | `#F4F3EF` | Primary button fill |
| `onInk` | `#FFFFFF` | `#0D0D0F` | Text on primary buttons |
| `accent` (Ember) | `#F2643A` | `#FF7A4F` | Progress, active state, highlights |
| `accentSoft` | `#FDE7DF` | `#3A1F17` | Accent tint backgrounds |
| `success` | `#2F9E5B` | `#46C47A` | Installed, done |
| `warning` | `#D68A00` | `#F5B02E` | Low storage, metered network |
| `danger` | `#D93D42` | `#FF6369` | Delete, errors |

**Category hues** (icon badges and subtle tints only — never large fills):
medicine `#E5484D`, survival `#F76B15`, education `#3E63DD`, diy `#12A594`,
agriculture `#46A758`, computing `#8E4EC6`, reference `#0090FF`, maps `#0B8A8A`,
ai `#7C5CFF`. The tint is the hue at 12% (light) / 20% (dark) opacity.

Primary buttons are **ink** (black in light mode, white in dark mode), not orange:
it keeps contrast AA-compliant and lets Ember stay meaningful.

## 3. Typography

Typeface: **Inter** (bundled, works offline, identical on both platforms).
Large titles use tight tracking for a modern editorial feel.

| Variant | Size / line | Weight | Tracking |
|---|---|---|---|
| `display` | 34 / 40 | 800 | -0.8 |
| `title1` | 28 / 34 | 700 | -0.6 |
| `title2` | 22 / 28 | 700 | -0.4 |
| `title3` | 19 / 24 | 600 | -0.2 |
| `headline` | 16 / 22 | 600 | -0.1 |
| `body` | 16 / 24 | 400 | 0 |
| `callout` | 15 / 21 | 500 | 0 |
| `footnote` | 13 / 18 | 500 | 0 |
| `caption` | 12 / 16 | 500 | 0.1 |
| `overline` | 11 / 14 | 700 | 0.8, UPPERCASE |

Numbers that change (sizes, percentages, progress) use `fontVariant: ['tabular-nums']`.

## 4. Space, shape, depth

- **4-pt grid.** Spacing tokens: `xxs 2, xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32, huge 48`.
- **Screen gutter:** 20. **Card padding:** 16. **Gap between cards:** 12.
- **Radii:** `sm 8` (chips, small buttons), `md 12` (inputs, rows), `lg 18` (cards),
  `xl 26` (hero cards, sheets), `pill 999`.
- **Depth:** flat by default. Cards use a 1-px `border` hairline in light mode and a
  slightly lighter `surface` in dark mode. Only floating elements (mini-player,
  download pill, FAB) get a soft shadow (`0 8 24 rgba(0,0,0,0.12)`).
- Use `borderCurve: 'continuous'` on iOS for squircle corners.

## 5. Iconography

- UI icons: **Lucide** (`lucide-react-native`), stroke width 2 (1.75 at ≥ 24 px),
  sizes 16 / 20 / 24.
- Tab bar: native icons (SF Symbols on iOS, Material Symbols on Android) via Expo
  Router `NativeTabs` so the bar gets Liquid Glass / Material 3 for free.
- Category icons sit in an **IconBadge**: 40×40 rounded-12 square, category tint
  background, category hue foreground.

## 6. Components (src/components/ui)

| Component | Notes |
|---|---|
| `Text` | Only way to render text. `variant`, `color` (token), `numberOfLines`. |
| `Screen` | Safe-area aware scroll container with large title header and gutter. |
| `Button` | `primary` (ink), `accent` (ember, rare), `secondary` (surfaceAlt), `ghost`, `danger`. Sizes `sm`/`md`/`lg`. Pill shape. Haptic on press. |
| `IconButton` | 40×40 circular, surfaceAlt fill. |
| `Card` | surface + hairline + radius lg; optional `onPress` with scale-down press feedback (0.98). |
| `ListRow` | Leading IconBadge/icon, title, subtitle, trailing accessory (chevron, size, switch). |
| `SectionHeader` | `overline` label + optional action link. |
| `Chip` | Filter/segment chip; selected = ink fill. |
| `ProgressBar` | 6-px track (surfaceAlt), ember fill, rounded, animated. |
| `ProgressRing` | For course and download progress in compact spots. |
| `StorageMeter` | Stacked bar per content type + legend. |
| `SearchField` | surfaceAlt fill, radius md, leading magnifier, clear button. |
| `EmptyState` | Large soft icon badge, title2, body, primary action. |
| `Badge` | Small pill: "Installed", "Update", sizes. |

## 7. Motion & haptics

- Durations: 120 ms (press), 220 ms (state change), 320 ms (screen-level).
- Easing: `Easing.out(Easing.cubic)`; springs `damping 18, stiffness 220` for sheets.
- Press feedback: scale to 0.98 + opacity 0.9. Never animate layout of long lists.
- Haptics: `selection` for toggles/chips, `impactLight` for primary actions,
  `notificationSuccess` when a download finishes.
- Respect *Reduce Motion*.

## 8. Layout patterns

- **Home:** greeting + storage summary hero card, "Continue" carousel (last article,
  course, map), quick-access grid of modules, active downloads.
- **Catalog:** category hero → tier cards (Essential / Standard / Comprehensive) with
  size, item count and a one-tap "Download pack".
- **Detail:** title, publisher, language, size, date, description, single primary CTA
  that becomes a progress bar while downloading.
- **Reader:** full-bleed content, minimal floating toolbar (back, search, TOC,
  bookmark, text size), auto-hides on scroll.
- **Sheets** (`formSheet`) for pickers and confirmations instead of alerts.

## 9. Voice & copy

- Spanish and English are both first-class. Strings live in `src/i18n/{es,en}.json`;
  no literal strings in components.
- Short, direct, friendly: "Descargar · 1,2 GB", not "Pulse aquí para iniciar la descarga".
- Sizes in decimal units (MB/GB) with locale formatting.
- Health content always carries the "información, no consejo médico" disclaimer.

## 10. Accessibility

- Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large text and icons.
- Support Dynamic Type / font scaling up to 1.3× without clipping (`allowFontScaling`
  stays on; layouts wrap).
- Every icon-only control has `accessibilityLabel`.
- Don't use color alone to signal state — pair with an icon or text.
