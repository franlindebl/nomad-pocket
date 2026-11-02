# Nomad Pocket — Style Guide

> "El conocimiento que nunca se desconecta." / "Knowledge that never goes offline."

Nomad Pocket is field gear, not a toy. The look is called **Precisión** (owner's choice, 2026-11-02):
black and signal yellow, square shapes finished with fine detail — 1 px lines, small corner marks on
panels and a diagonal cut on the corner of the few things that matter. Think "the panel of a field
instrument" or "a technical drawing", never a construction-site sign (thick borders, everything in
capitals) and never the cream-and-orange look of AI-generated apps it replaced.

**The app is dark only.** `app.json` fixes `userInterfaceStyle: "dark"`, there is no appearance setting,
and the theme has one palette (`useTheme()` returns it; `scheme` is always `'dark'`). The reader shows
archives with its dark CSS (invert, media re-inverted).

All tokens live in `src/theme/tokens.ts`. Never hard-code a color, size or radius in
a screen — use the theme.

---

## 1. Principles

1. **Content first.** Chrome recedes; articles, maps and answers take the screen.
2. **One accent.** *Signal yellow* is reserved for progress, active state and the single most
   important action on a screen (on Home: the emergency number). Everything else is light ink on black.
3. **Detail where it counts.** Corner marks and cut corners are the signature: only on panels and on
   the one or two key controls of a screen. On everything, they become noise again.
4. **Honest about size.** Every downloadable thing shows its size and what it costs
   in free storage *before* the user commits.
5. **Offline is the normal state.** No spinners waiting on a network that isn't there;
   explain clearly when something needs a connection.
6. **Touch-friendly.** Minimum hit target 44×44 pt; primary actions in thumb reach.

## 2. Color

Very dark grey (not pure black: OLED smears pure black while scrolling), light ink and one yellow.

| Token | Value | Use |
|---|---|---|
| `bg` | `#0C0C0C` | Screen background; also the inside of icon badges |
| `surface` | `#131313` | Cards, panels, rows, sheets |
| `surfaceAlt` | `#1B1B1B` | Secondary buttons, inactive controls, skeletons |
| `surfacePressed` | `#242424` | Pressed rows, progress tracks, Android tab ripple |
| `border` | `#232323` | Hairlines, dividers, panel outlines |
| `outline` | `#2E2E2E` | Outlines of controls: icon buttons, chips, inputs, the composer, icon badges |
| `tick` | `#5A5A5A` | The corner marks of panels (`CornerTicks`) |
| `text` | `#F2F2EF` | Primary text |
| `textSecondary` | `#8F8F89` | Secondary text, metadata, mono labels |
| `textTertiary` | `#5F5F5A` | Placeholders, disabled |
| `accent` | `#FFD60A` | Signal yellow: primary buttons, progress, active state, links. Reads both as fill and as text on black |
| `onAccent` | `#0C0C0C` | Text/icons on yellow |
| `accentSoft` | `#2B2507` | Yellow-tinted backgrounds (a switched-on toggle, citations) with `accent` text |
| `ink` / `onInk` | `#FFD60A` / `#0C0C0C` | Fill of the strongest small controls (the composer's stop button, `IconButton variant="ink"`) |
| `success` / `successSoft` | `#3DD68C` / `#0E2A1D` | Installed, done |
| `warning` / `warningSoft` | `#FF9F0A` / `#33220A` | Low storage, metered network (orange, so it never reads as the brand yellow) |
| `danger` / `dangerSoft` | `#FF453A` / `#3A1513` | Delete, errors |
| `location` | `#4C8DF6` | The user's position on the map: the puck (map `tintColor`) and the compass beam (baked into `assets/maps/beam/*.png` by `scripts/maps/make-beam.py`: rerun it after changing this) |
| `signFace`, `signRing`, `signText` | `#FFFFFF`, `#D93D42`, `#18171B` | The speed limit sign while navigating (`SpeedBadge`): a real sign's colours |
| `overlay` | `rgba(0,0,0,.6)` | Scrims behind popovers |
| `shadow` | `rgba(0,0,0,.5)` | Floating elements |

**Category hues** (icon strokes and subtle tints only — never large fills), tuned to read on black:
medicine `#FF6B6B`, survival `#FFD60A`, education `#8AA4FF`, diy `#3DD6C3`, agriculture `#86D96B`,
computing `#B992FF`, reference `#5DB4FF`, maps `#4FD1A5`, ai `#F2F2EF` (white: no AI purple),
courses `#8AA4FF`, neutral `#8F8F89` (`hues` in `tokens.ts`). `tint(hex)` is the hue at 16 %.

Yellow carries dark text, never white; yellow text is fine on the dark surfaces.

## 3. Typography

Three bundled OFL families (they work offline; static files per weight in `assets/fonts`, wired in
`app.json` › expo-font):

- **Chakra Petch** (`displayFamily`): titles, figures, button labels, tab and header titles. Its letters
  already have cut corners, the same gesture as the shapes.
- **IBM Plex Sans** (`fontFamily`): all running text, rows, inputs.
- **IBM Plex Mono** (`monoFamily`): overline labels, badges, the composer toggle, code in answers.

| Variant | Family | Size / line | Weight | Tracking |
|---|---|---|---|---|
| `display` | Chakra Petch | 28 / 32 | 700 | 0.3, UPPERCASE |
| `title1` | Chakra Petch | 25 / 30 | 700 | 0 |
| `title2` | Chakra Petch | 21 / 26 | 600 | 0 |
| `title3` | Chakra Petch | 18 / 23 | 600 | 0 |
| `headline` | Plex Sans | 16 / 22 | 600 | -0.1 |
| `body` | Plex Sans | 16 / 24 | 400 | 0 |
| `callout` | Plex Sans | 15 / 21 | 500 | 0 |
| `footnote` | Plex Sans | 13 / 18 | 500 | 0 |
| `caption` | Plex Sans | 12 / 16 | 500 | 0.1 |
| `overline` | Plex Mono | 11 / 14 | 500 | 1.3, UPPERCASE |

Loaded weights: Chakra Petch 500/600/700, Plex Sans 400/500/600/700, Plex Mono 400/500 (a missing
weight falls back to the nearest one). Buttons use Chakra Petch 600 in capitals with 0.9 tracking.
Numbers that change (sizes, percentages, progress) use `fontVariant: ['tabular-nums']`.

## 4. Space, shape, depth

- **4-pt grid.** Spacing tokens: `xxs 2, xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32, huge 48`.
- **Screen gutter:** 20 (`space.gutter`). **Card padding:** 16. **Gap between cards:** 8–12.
- **Square.** Corners are 0 (`radius.lg`/`xl` are 0, `sm`/`md` are 2 for tiny details); `radius.pill`
  stays for real circles (dots, the user's location).
- **Panels** (`Card`, `ListGroup`): `surface`, a 1 px `border` outline and `CornerTicks` — two small L
  marks (9 pt, 1.5 pt thick, `tick` colour) at the top-left and bottom-right corners.
- **Cut corners** (`ChamferFill`): the top-right corner of the key controls is cut on the diagonal
  (`chamfer` tokens: `sm 7` small controls, `md 10` buttons and the user's message, `lg 16` the Home
  emergency block). Used by primary buttons, the send button, the user's message (bottom-right) and
  Home's emergency block. Nothing else.
- **Depth:** flat. Only floating elements (map buttons, toasts, popovers) get a soft shadow in the
  `shadow` token. No glows, no gradients.

## 5. Iconography

- UI icons: **Lucide** (`lucide-react-native`), stroke width 2 (1.75–1.9 at ≥ 22 px),
  sizes 16 / 20 / 24. The assistant is a message icon (`MessageSquareText`), never sparkles.
- Tab bar: native icons (SF Symbols on iOS, Material Symbols on Android) via Expo
  Router `NativeTabs`, tinted yellow; the bar keeps Liquid Glass / Material 3.
- Category icons sit in an **IconBadge**: a 40×40 square, `bg` fill, 1 px `outline`, the icon stroked
  in the category hue.

## 6. Components (src/components/ui)

All exported from `@/components/ui` (`src/components/ui/index.ts`).

| Component | Notes |
|---|---|
| `Text` | Only way to render text. `variant`, `color` (token), `tabular` (tabular numbers), `numberOfLines`. |
| `Screen` | Scroll container: gutter, 720 pt column, room for the tab bar. `title` (+ `headerRight`) draws the in-content large title used by tab roots (the native large title renders blank inside native tabs on iOS 26). `static` for non-scrolling screens. |
| `Button` | `primary` (signal yellow, cut corner; `accent` is the same), `secondary` (surfaceAlt + outline), `ghost`, `danger`. Sizes `sm`/`md`/`lg`, optional icon, `fullWidth`. Square, label in Chakra Petch capitals. Haptic on press. |
| `IconButton` | Square icon control (default 40×40; variants `filled` (surface + outline), `plain`, `ink` (yellow)). Needs `accessibilityLabel`. |
| `Card` | Square panel: surface, 1 px border, `CornerTicks` (`ticks={false}` to drop them; a `background` card has neither); optional `onPress` with scale-down press feedback (0.98). |
| `ListRow` / `ListGroup` | Row with leading IconBadge/icon, title, subtitle, `trailing` accessory (chevron, size, switch). `trailingAction` puts a separate button beside the row (a button inside the row's pressable would be unreachable by VoiceOver). A row that toggles (kit checklist) passes `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}`. A row whose action its title doesn't say (a trash row in Settings that deletes) passes `accessibilityHint`. `ListGroup` groups rows in one card; a long list (`FlatList`, e.g. `settings/packages.tsx`) can't be wrapped in one, so its rows draw the inset card piecewise. |
| `SectionHeader` | Mono `overline` label, a hairline running to the edge, optional action link (yellow). |
| `Chip` | Filter/segment chip with optional icon, square with an outline; selected = yellow fill. |
| `Segmented`, `Switch` | Segmented control (language, text size…; it doesn't fire for the already selected option; selected = yellow) and themed switch (yellow track). |
| `ProgressBar` | 6-px square bar (surfacePressed track, yellow fill), animated. `segments={n}` draws n slanted segments instead (Home's readiness: one per piece of the kit). |
| `ProgressRing` | Course and download progress in compact spots (butt line caps). |
| `IconBadge` | Category icon in a square outline (`hue`, `size`). |
| `SearchField` | surface fill, 1 px outline, square, leading magnifier, clear button. |
| `EmptyState` | Large soft icon badge, title, body, primary action. |
| `Badge` | Small square tag in mono capitals: "Installed", "Update". |
| `Divider`, `Row` | Hairline separator; horizontal flex row with `gap`/`align`. |
| `CornerTicks`, `ChamferFill` | The two signature shapes (`Shapes.tsx`): corner marks over a 1 px outline (render last), and a fill with one corner cut on the diagonal (render first in a transparent box; it measures itself, drawing a plain rectangle until the first layout). |
| `PressableScale`, `triggerHaptic` | Base pressable with press scale + haptic; haptic helper. `restOpacity` dims a row at rest (a disabled-looking action that still explains itself when tapped). |

Outside the kit: `components/Toast.tsx` (`showToast`, e.g. "download finished"; announced to VoiceOver on iOS, a live region on Android) and
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

- **Home** (the survival-kit layout, `docs/UX_SURVIVAL_PLAN.md`): app name with the network
  line (a small square, yellow when offline, and a mono label) and the downloads / settings icon
  buttons; under "En una emergencia" the emergency number as one big yellow block with a cut corner
  and a faint diagonal hatch (`home-call`), then a row of three panels (emergency services nearby,
  first aid or survival guides, family plan); a downloads card while something downloads; the
  "Tu preparación" card (the figure "5/6" in Chakra Petch, slanted segments, a status row per piece),
  the continue list and a storage line.
- **Map:** the "© OpenStreetMap contributors" credit shows when the map first appears and fades
  after about five seconds or the first gesture; store screenshots of the map must show it.
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
- Distances and water follow the device region, not the app language: `formatDistance` / `formatWater`
  (`lib/format.ts`) show m/km and litres, ft/mi and gallons in the US, yd/mi in the UK. Never write a
  unit into a string ("{{meters}} m"): pass the formatted value.
- The single English locale is US English (color, center, flashlight, cellular data): the US is the
  biggest English-speaking store, and British readers understand it.
- Health content always carries the "información, no consejo médico" disclaimer.

## 10. Accessibility

- Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large text and icons.
- Support Dynamic Type / font scaling up to 1.3× without clipping (`allowFontScaling`
  stays on; layouts wrap).
- Every icon-only control has `accessibilityLabel`.
- Never nest a pressable inside another one (iOS merges them for VoiceOver); use
  `ListRow`'s `trailingAction`. Controls E2E flows need get a `testID` (`docs/E2E.md`).
- Don't use color alone to signal state — pair with an icon or text.
