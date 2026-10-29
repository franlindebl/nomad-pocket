# Google Play listing and forms — 1.1.0 (2026-10-29)

Everything Play Console asks before the first release, adapted from the App Store listing approved by
the owner (`listing-1.1.0.md`; the owner approved this file on 2026-10-29). **In Play Console since
2026-10-29** (app id 4972946077817579435): app created, App content forms saved, store settings, the es-ES
listing texts, icon and feature graphic (listing saved as a draft: phone screenshots and the en-US
translation still missing). Automatic protection (Play's installer check) is **off**: it injects Google's
closed code into the app (owner's decision, no proprietary code next to libkiwix). Play limits: app name 30, short description 80, full description 4000.
Play has no subtitle, promotional text or keywords: the short description does that job and Play
indexes the full description.

Developer account: personal (id 5502748653724108225), which already has two apps. Every new app in it
must pass a **closed test with at least 12 testers who opted in, for 14 days in a row**, before it can
apply for production (seen on another app's dashboard, 2026-10-29). Plan for it: internal test first
(no review wait, up to 100 testers), then the closed test, then production.

## App details (Create app)

| Field | Value |
|---|---|
| App name | Nomad Pocket: Kit Offline (es-ES) / Nomad Pocket: Offline Kit (en-US) |
| Default language | Español (España) – es-ES; translation en-US (en-GB optional, same texts) |
| App or game | App |
| Free or paid | Free (can't be changed to paid later) |
| Category | Books & Reference (Libros y obras de consulta) |
| Tags | Offline maps, Emergency, Encyclopedia, Survival, Navigation (pick the closest Play offers) |
| Contact email | fran.linde.blazquez@gmail.com |
| Website | https://franlindebl.github.io/nomad-pocket/ |
| Privacy policy | https://franlindebl.github.io/nomad-pocket/privacy.html |

## Short description (80)

- es: `Mapas, rutas, emergencias, Wikipedia y una IA que funcionan sin internet.` (73)
- en: `Maps, routes, emergency help, Wikipedia and an AI that work with no internet.` (78)

## Full description

Same as the App Store description in `listing-1.1.0.md`, with these changes (Android has no Apple
Intelligence):

- es, "UNA IA QUE NO NECESITA INTERNET": `• Funciona en tu teléfono, con un modelo abierto que descargas una vez`
- en, "AN AI THAT DOESN'T NEED THE INTERNET": `• Runs on your phone, with an open model you download once`
- es, add to that section: `• ¿Una respuesta inapropiada? Repórtala desde la propia respuesta`
- en, add to that section: `• An inappropriate answer? Report it from the answer itself`

Everything else (kit, emergency, maps, library, privacy, open source credits, the medical and AI
disclaimer) is true on Android too: emergency numbers, routing, search, the plan's PDF and the
expiry reminders were checked on the emulator (Android tour, `docs/E2E.md`).

## Graphics

| Asset | Size | Status |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit | `docs/store/play/icon-512.png` (from `assets/images/icon.png`) |
| Feature graphic | 1024 × 500 PNG/JPEG, no alpha | `docs/store/play/feature-<lang>.png` |
| Phone screenshots | 2–8, 9:16, each side 320–3840 px, long side ≤ 2× short side | to capture on the Android emulator: the iPhone shots (1320 × 2868) are over the 2:1 limit and show iOS UI |
| 7" / 10" tablet screenshots | optional (needed to be featured for tablets) | not planned for 1.1.0 |

## Store settings

- Countries: all. Contains ads: **No**. In-app purchases: none.
- Pre-registration: no.

## App content (Política › Contenido de la aplicación)

| Form | Answer |
|---|---|
| Privacy policy | URL above |
| App access | All functionality is available without special access (no sign-in) |
| Ads | No ads |
| Content rating (IARC) | See "Content rating" below. Original draft: category "Reference, News, or Educational". Violence, sex, language, controlled substances, gambling: no. Users interact or exchange content: no. Shares the user's location with other users: **yes** (the "Share my position" button sends it by message, only when the user taps it). Unrestricted internet access: no (archive pages are offline; external links ask first). Digital purchases: no. Generative AI: yes, on-device (answer the AI questions if the form shows them) |
| Target audience | 18 and over (13+ first, then 18+ to match the PEGI 18 below; back to 13+ if the rating comes down) |
| News app | No |
| COVID-19 contact tracing / status | No |
| Data safety | see below |
| Government app | No |
| Financial features | None |
| Health apps | "Emergencias y primeros auxilios" and "Educación y referencias médicas". No medical device features, no health data collected |
| Actions / foreground services | None declared (the manifest has no foreground service, no exact alarms, no background location) |

## Content rating (as submitted, 2026-10-29)

Category "Todos los demás tipos de aplicaciones" (the questionnaire has no reference category). Package
content: no. Users exchange content: no. Online content (downloaded archives, AI answers): yes. Violence:
yes, not the main purpose, visual and gory (injury photos in the medical guides), in text. Sexuality: no
(encyclopedic nudity is "natural or scientific context", which the question excludes). Language: yes (mild,
moderate, discriminatory and sexual words quoted in encyclopedia articles), not the main purpose. Drugs: yes,
text only. Age-restricted products: no. Shares location with other users: yes. Digital purchases, rewards,
browser: no. Primarily informational/educational: yes.

Result: ClassInd L, ESRB 10+, **PEGI 18**, USK 12, IARC generic 18+, Russia 18+, Korea 19. The first,
literal questionnaire (sexuality yes, drug images yes) gave the same. Gory images and discriminatory language
are what PEGI rates 18. Kiwix and Wikipedia (same content) are PEGI 3 on Play, but Google's help has no
exception for reference content ("specific to the content within your app"; misrepresentation can lead to
removal). Owner's decision: keep PEGI 18 with an 18+ audience and ask IARC (globalratings.com/contact-us) how
to rate a reader of downloadable encyclopedias and medical guides; redo the questionnaire if they allow it.

## Data safety

Answers, matching `site/privacy.html` (re-read it before filling this in):

- **Does your app collect or share any of the required user data types?** No.
  - Location, the family plan, contacts typed into it, questions to the assistant, voice for dictation:
    all processed only on the device, never sent off it, so Play doesn't count them as collected
    ("data processed ephemerally on the device" / "on-device only").
  - Sharing the position by message and "Report answer" are user-initiated: the app hands text to
    another app the user picks (messages, mail) and sends nothing itself.
  - Content downloads (Kiwix and its mirrors, GitHub Releases, Hugging Face, Protomaps, OSM data) send
    no user data beyond the request itself; there are no analytics, crash reporting or ads SDKs, and no
    Play services or Firebase in the APK (`docs/RELEASE.md`, Android).
- Is all user data encrypted in transit? (only asked if something is collected) — downloads use HTTPS.
- Account creation: the app has no accounts (no deletion URL needed).
- Independent security review: no.

## Release notes for the first Play release

- es: `Primera versión para Android: tu kit para cuando se caiga internet. Mapas y rutas sin conexión, emergencias cerca de ti, Wikipedia y guías médicas, plan familiar y un asistente de IA que funciona en tu teléfono.`
- en: `First Android release: your kit for when the internet goes down. Offline maps and routes, emergency help near you, Wikipedia and medical guides, a family plan and an AI assistant that runs on your phone.`
