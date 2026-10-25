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
| `surfacePressed` | `#E6E3DD` | `#28282D` | Pressed rows, Android tab ripple |
| `onAccent` | `#FFFFFF` | `#FFFFFF` | Text/icons on accent fills |
| `successSoft` / `warningSoft` / `dangerSoft` | `#DDF3E5` / `#FCEFD3` / `#FBE1E1` | `#12301F` / `#33260C` / `#3A1517` | Status tint backgrounds (banners, badges) |
| `overlay` | `rgba(24,23,27,.45)` | `rgba(0,0,0,.6)` | Scrims behind popovers |
| `shadow` | `rgba(24,23,27,.12)` | `rgba(0,0,0,.5)` | Floating elements |

**Category hues** (icon badges and subtle tints only — never large fills):
medicine `#E5484D`, survival `#F76B15`, education `#3E63DD`, diy `#12A594`,
agriculture `#46A758`, computing `#8E4EC6`, reference `#0090FF`, maps `#0B8A8A`,
ai `#7C5CFF`, courses `#3E63DD`, neutral `#6A6760` (`hues` in `tokens.ts`). The tint is the hue at 12% (light) / 20% (dark) opacity.

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
- **Screen gutter:** 20 (`space.gutter`). **Card padding:** 16. **Gap between cards:** 12.
- **Radii:** `sm 8` (chips, small buttons), `md 12` (inputs, rows), `lg 18` (cards),
  `xl 26` (hero cards, sheets), `pill 999`.
- **Depth:** flat by default. Cards use a 1-px `border` hairline in light mode and a
  slightly lighter `surface` in dark mode. Only floating elements (map buttons,
  toasts, popovers) get a soft shadow in the `shadow` token
  (offset 4, radius 12 for map buttons; 8 / 24 for the chat composer).
- Use `borderCurve: 'continuous'` on iOS for squircle corners.

## 5. Iconography

- UI icons: **Lucide** (`lucide-react-native`), stroke width 2 (1.75 at ≥ 24 px),
  sizes 16 / 20 / 24.
- Tab bar: native icons (SF Symbols on iOS, Material Symbols on Android) via Expo
  Router `NativeTabs` so the bar gets Liquid Glass / Material 3 for free.
- Category icons sit in an **IconBadge**: 40×40 rounded-12 square, category tint
  background, category hue foreground.

## 6. Components (src/components/ui)

All exported from `@/components/ui` (`src/components/ui/index.ts`).

| Component | Notes |
|---|---|
| `Text` | Only way to render text. `variant`, `color` (token), `tabular` (tabular numbers), `numberOfLines`. |
| `Screen` | Scroll container: gutter, 720 pt column, room for the tab bar. `title` (+ `headerRight`) draws the in-content large title used by tab roots (the native large title renders blank inside native tabs on iOS 26). `static` for non-scrolling screens. |
| `Button` | `primary` (ink), `accent` (ember, rare), `secondary` (surfaceAlt), `ghost`, `danger`. Sizes `sm`/`md`/`lg`, optional icon, `fullWidth`. Pill shape. Haptic on press. |
| `IconButton` | Circular icon control (default 40×40; variants `filled` (surfaceAlt), `plain`, `ink`). Needs `accessibilityLabel`. |
| `Card` | surface + hairline + radius lg; optional `onPress` with scale-down press feedback (0.98). |
| `ListRow` / `ListGroup` | Row with leading IconBadge/icon, title, subtitle, `trailing` accessory (chevron, size, switch). `trailingAction` puts a separate button beside the row (a button inside the row's pressable would be unreachable by VoiceOver). A row that toggles (kit checklist) passes `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}`. `ListGroup` groups rows in one card. |
| `SectionHeader` | `overline` label + optional action link. |
| `Chip` | Filter/segment chip with optional icon; selected = ink fill. |
| `Segmented`, `Switch` | Segmented control (theme, text size…) and themed switch. |
| `ProgressBar` | 6-px track (surfaceAlt), ember fill, rounded, animated. |
| `ProgressRing` | Course and download progress in compact spots. |
| `IconBadge` | Category icon in a tinted rounded square (`hue`, `size`). |
| `SearchField` | surfaceAlt fill, radius md, leading magnifier, clear button. |
| `EmptyState` | Large soft icon badge, title, body, primary action. |
| `Badge` | Small pill: "Installed", "Update", sizes. |
| `Divider`, `Row` | Hairline separator; horizontal flex row with `gap`/`align`. |
| `PressableScale`, `triggerHaptic` | Base pressable with press scale + haptic; haptic helper. |

Outside the kit: `components/Toast.tsx` (`showToast`, e.g. "download finished") and
`components/navigation.ts` (`useStackOptions`, `largeTitle`). Feature-specific pieces live
in their feature (`features/catalog/DownloadButton`, `features/courses/CourseCard`,
`features/library/components/*`, `features/assistant/ui/*`, `features/maps/MapFab`).

## 7. Motion & haptics

- Durations: 120 ms (press), 220 ms (state change), 320 ms (screen-level).
- Easing: `Easing.out(Easing.cubic)`; springs `damping 18, stiffness 220` for sheets.
- Press feedback: scale to 0.98 + opacity 0.9. Never animate layout of long lists.
- Haptics: `selection` for toggles/chips, `impactLight` for primary actions,
  `notificationSuccess` when a download finishes.
- Respect *Reduce Motion*.

## 8. Layout patterns

- **Home:** greeting + storage summary hero card, "Continue" carousel (last pages read
  across archives), quick-access grid of modules, active downloads.
- **Catalog:** category hero → tier cards (Essential / Standard / Comprehensive) with
  size, item count and a one-tap "Download pack".
- **Detail:** title, publisher, language, size, date, description, single primary CTA
  that becomes a progress bar while downloading.
- **Reader:** full-bleed content, minimal toolbar (back, forward, search,
  bookmark, text size, more — the table of contents lives in More). Auto-hiding on scroll is planned, not built yet.
- **Sheets** (`formSheet`) for pickers and confirmations instead of alerts.
- **Wide screens (iPad):** content is a centred column of `layout.maxContentWidth` (720 pt).
  `Screen` does it; screens with their own `ScrollView`/`FlatList` spread `layout.column`
  into the content container style. Full-bleed content (map, reader) stays full width.

## 9. Voice & copy

- Spanish and English are both first-class. Strings live in `src/i18n/locales/<lang>/<namespace>.json`
  (one namespace per feature, registered in `src/i18n/resources.ts`); no literal strings in
  components. `npm run check:i18n` catches missing keys.
- Short, direct, friendly: "Descargar · 1,2 GB", not "Pulse aquí para iniciar la descarga".
- Sizes in decimal units (MB/GB) with locale formatting.
- Health content always carries the "información, no consejo médico" disclaimer.

## 10. Accessibility

- Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large text and icons.
- Support Dynamic Type / font scaling up to 1.3× without clipping (`allowFontScaling`
  stays on; layouts wrap).
- Every icon-only control has `accessibilityLabel`.
- Never nest a pressable inside another one (iOS merges them for VoiceOver); use
  `ListRow`'s `trailingAction`. Controls E2E flows need get a `testID` (`docs/E2E.md`).
- Don't use color alone to signal state — pair with an icon or text.
