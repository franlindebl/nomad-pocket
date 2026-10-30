# Google Play listing and forms — 1.1.0 (2026-10-29)

Policies, track state and release steps: `docs/ANDROID_PLAY.md`. This file holds the texts and form answers.

Everything Play Console asks before the first release, adapted from the App Store listing approved by
the owner (`listing-1.1.0.md`; the owner approved this file on 2026-10-29). **In Play Console since
2026-10-29** (app id 4972946077817579435): app created, App content forms saved, store settings, the es-ES
listing texts, icon and feature graphic, and since the afternoon the es-ES and en-US listings complete with
the Android phone screenshots (`docs/store/marketing/<lang>/android/`). Automatic protection (Play's installer check) is **off**: it injects Google's
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

Same as the App Store description in `listing-1.1.0.md`, with these changes. Android has no Apple
Intelligence, and **no health features** (Google Play only lets organization accounts publish medical
apps; see "Health apps" below), so nothing about first aid, medical guides or medical details:

- es, intro: `… dónde están el hospital o el agua potable más cercanos y qué hacer ante una herida.` → `… dónde están el hospital o el agua potable más cercanos y cómo potabilizarla.`
- en, intro: `… where the nearest hospital or drinking water is, and what to do about a wound.` → `… where the nearest hospital or drinking water is, and how to make it safe.`
- "CUANDO LLEGA LA EMERGENCIA" / "WHEN THE EMERGENCY COMES": drop the first-aid line; plan line →
  `• Plan familiar: puntos de encuentro, contactos y números importantes, también en PDF para imprimir` /
  `• Family plan: meeting points, contacts and important numbers, also as a printable PDF`
- Library: `• Más de 80 colecciones: supervivencia, agua y alimentos, agricultura, reparaciones, informática… y miles más del catálogo de Kiwix` /
  `• 80+ collections: survival, water and food, farming, repairs, computing… plus thousands more from the Kiwix catalog`;
  `• 12 cursos…` / `• 12 courses…` (88 archives and 12 courses once the health ones are out)
- es, "UNA IA QUE NO NECESITA INTERNET": `• Funciona en tu teléfono, con un modelo abierto que descargas una vez`
- en, "AN AI THAT DOESN'T NEED THE INTERNET": `• Runs on your phone, with an open model you download once`
- es, add to that section: `• ¿Una respuesta inapropiada? Repórtala desde la propia respuesta`
- en, add to that section: `• An inappropriate answer? Report it from the answer itself`
- Last line: `La IA puede equivocarse. En una emergencia, llama siempre a los servicios de emergencia si puedes.` /
  `The AI can make mistakes. In an emergency, always call the emergency services if you can.`

Everything else (kit, emergency points and number, maps, library, privacy, open source credits) is true on
Android too: emergency numbers, routing, search, the plan's PDF and the expiry reminders were checked on the
emulator (Android tour, `docs/E2E.md`).

## Graphics

| Asset | Size | Status |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit | `docs/store/play/icon-512.png` (from `assets/images/icon.png`) |
| Feature graphic | 1024 × 500 PNG/JPEG, no alpha | `docs/store/play/feature-<lang>.png` |
| Phone screenshots | 2–8, 9:16, each side 320–3840 px, long side ≤ 2× short side | `docs/store/marketing/<lang>/android/`, 8 per language (the iPhone shots are over the 2:1 limit and show iOS UI) |
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
| Target audience | 13 and over (13–15, 16–17, 18+). It was 18+ while the rating was PEGI 18; back to 13+ with the PEGI 3 rating of 2026-10-29 |
| News app | No |
| COVID-19 contact tracing / status | No |
| Data safety | see below |
| Government app | No |
| Financial features | None |
| Health apps | **"My app doesn't provide any health features"** (from 1.1.0 (26), the build without them). The first submission declared "Emergency and First Aid" and "Medical Reference and Education" and was rejected on 2026-10-29: those categories need an organization account. Play support (ticket of 2026-10-29) said what to remove; `src/lib/health.ts` turns it off on Android |
| Actions / foreground services | None declared (the manifest has no foreground service, no exact alarms, no background location) |

## Content rating (2026-10-29, build without health features)

Category "Todos los demás tipos de aplicaciones" (the questionnaire has no reference category). Package
content: no. Users exchange content: no. Online content (downloaded archives, AI answers): yes. Violence,
sexuality, language, controlled substances, age-restricted products: no. Shares location with other users:
yes. Digital purchases, rewards, browser: no. Primarily informational/educational: yes.

Result: **PEGI 3**, ESRB Everyone, with "shared location" as the interactive element.

Why "no" to violence, language and drugs: the only content the app ships is its own UI; what users download is
third-party reference content (Wikipedia and other Kiwix archives), described in text the way an encyclopedia
describes it. Kiwix and Wikipedia, which offer the same content, are PEGI 3 on Play; the owner chose to rate it
the same way. The injury photos of the medical guides, which gave the first submission PEGI 18 (gory images),
are out of the Android build.

First submission (2026-10-29, with health features): violence yes (gory, injury photos), language yes
(discriminatory words quoted in articles), drugs in text: ClassInd L, ESRB 10+, PEGI 18, USK 12, IARC 18+.
The question to IARC sent that day (globalratings.com/contact-us) is moot now unless they answer otherwise.

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

- es: `Primera versión para Android: tu kit para cuando se caiga internet. Mapas y rutas sin conexión, emergencias cerca de ti, Wikipedia y guías de supervivencia, plan familiar y un asistente de IA que funciona en tu teléfono.`
- en: `First Android release: your kit for when the internet goes down. Offline maps and routes, emergency help near you, Wikipedia and survival guides, a family plan and an AI assistant that runs on your phone.`

## Health features on Android (2026-10-29)

The closed test 1.1.0 (24) was rejected on 2026-10-29 (Play Console Requirements: "some types of apps can
only be distributed by organizations"). The owner's account is personal and will stay so. Play support's
answer (ticket of 2026-10-29): declaring no health features is only accurate once the app, the bundle and the
listing have none; to ship from a personal account remove the downloadable medical and first-aid archives,
make sure the assistant gives no medical answers, and remove first-aid instructions and health-specific
guidance from the preparedness section. Emergency numbers and the map's hospitals and pharmacies are fine
as general utility.

Off on Android (`HEALTH_FEATURES` in `src/lib/health.ts`, fixed at build time; iOS keeps everything):
the medicine category and every medical archive, plus "Después del desastre" (mostly first aid), out of the
bundled catalog (`features/catalog/health-core.ts`) and out of Explore; the 2 health courses; Home's first-aid
shortcut (a survival guides shortcut instead); the onboarding's medical guides; the assistant's first-aid note
and any answer to a health question (a fixed reply with the emergency number); the plan's health card
(medication, allergies, blood type). Kept: the kit's health supplies (a shopping list, like Ready.gov's),
Ready.gov and CD3WD, Wikipedia, the reader's "not medical advice" banner.

To bring them back on Android: an organization account (D-U-N-S), the Health apps declaration updated, and
`HEALTH_FEATURES` true on Android in a new release. Never through a remote switch: Play forbids features
turned on after review that the declarations don't list.

With the medical guides gone the content rating was redone: PEGI 3 ("Content rating" above).

Android screenshots redone on 2026-10-29 (home, a survival guide instead of first aid, the assistant answering the
water starter, library and kit without medicine; Android captions in `scripts/store-screenshots.py`) and uploaded to
both listings.

Sent to review with the closed test 1.1.0 (26) on 2026-10-30.
