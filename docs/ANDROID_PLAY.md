# Android on Google Play — policies, decisions and how to ship

Single entry point for anything about the Android build and Google Play: the rules we must keep, why
they exist, where each one lives in the code, the current state of the Play tracks and the exact steps
of a release. Written for the next session (human or agent) to work from without re-deriving anything.
Details that already live elsewhere are linked, not repeated:

| Doc | What it adds |
|---|---|
| `docs/store/play-listing.md` | Every Play Console text and form answer (listing, App content, Data safety, content rating, release notes) |
| `docs/RELEASE.md`, "Android (Google Play)" | Upload key, AAB build commands, ABIs, 16 KB pages, notices |
| `docs/PROGRESS.md`, log of 2026-10-29/30 | What was done day by day |
| `docs/E2E.md` | Android tour (`npm run e2e:android`, 4 flows) |

## 1. Hard rules (read before touching Android or Play Console)

1. **No health features on Android.** The Play account is personal. Google Play only lets organization
   accounts publish apps with health features, and the owner won't create one (not self-employed and won't
   register as such). Anything about health, medicine or first aid is gated on `HEALTH_FEATURES`
   (`src/lib/health.ts`, false on Android). New code that touches health **must** be gated on it (section 4).
2. **`HEALTH_FEATURES` is fixed at build time, never remote.** Play forbids turning on, after review, features
   the declarations don't list. No server flag, no catalog field, no kv switch may bring health back on Android.
3. **No Google Play services, Firebase or other proprietary code in the APK.** libkiwix is GPL; the owner chose
   (option A, 2026-10-28) to ship no proprietary library next to it. A dependency that pulls
   `com.google.android.gms`, Firebase or the Install Referrer needs the same treatment as the current ones
   (section 5). Play's "automatic protection" (installer check) stays **off** for the same reason.
4. **Never misrepresent the app to Google.** Declarations must match the binary, the listing and the screenshots.
   If the app changes (a new feature, a new permission, new data leaving the device), update the matching form
   (`docs/store/play-listing.md`) in the same release.
5. **Who does what in Play Console** (the agent drives Chrome, the owner decides):
   - The owner uploads AABs (files over 10 MB can't be uploaded by the agent's browser tool).
   - The owner accepts any terms, declarations or policies (IARC terms, Health apps checkboxes, app creation).
   - The owner clicks **«Enviar cambios a revisión»**. The agent prepares everything and says when it's ready.
   - The agent never enters passwords or keys and never changes account or security settings.
6. **`versionCode` grows with every upload** (`app.json` › `android.versionCode`), even for a build that never
   reaches review. Tag each uploaded build `v<version>-android-<versionCode>` unless iOS and Android share the
   commit (`docs/RELEASE.md`).
7. `android/` is generated (CNG): never edit it. Configure in `app.json`, `plugins/` and `modules/*`.

## 2. Current state (2026-10-30)

| Item | State |
|---|---|
| Play account | Personal, id 5502748653724108225 (also holds Theri.App and Semáforo del Sueño) |
| App | Nomad Pocket, id 4972946077817579435, package `com.fjlinde.nomadpocket`, created 2026-10-29 |
| Internal testing | 1.1.0 (23), list "Nomad Pocket interno" (the owner's two accounts). Still has health features: internal only |
| Closed testing ("Prueba cerrada - Alpha") | 1.1.0 (24) **rejected** 2026-10-29 (health apps need an organization). **1.1.0 (26) sent to review 2026-10-30** with the redone listing and forms (15 changes). Testers: account list "Friends and family" (19 addresses), all countries |
| Production | Not yet. A new app in a personal account needs a closed test with **≥ 12 opted-in testers for 14 days in a row** before it can apply |
| Content rating | PEGI 3 / ESRB Everyone (redone 2026-10-29; the first one was PEGI 18 because of injury photos in medical guides) |
| Target audience | 13 and over |
| Health apps declaration | "My app doesn't provide any health features" |
| Builds | 25: first build without health, superseded before review (never uploaded). 26: 25 + assistant fixes (tag `v1.1.0-android-26`, commit e25bef1) |

Next steps, in order:

1. Wait for Google's review of 26. If rejected, read the reason in Play Console › Policy status (and the email),
   fix it, bump `versionCode`, rebuild, upload, resubmit.
2. When approved: testers opt in through the closed-test link; keep **12+ testers active for 14 days**.
3. Then apply for production from the dashboard (Play asks questions about the test) and publish to production.
4. Open items: the owner's dedicated Gmail to replace the public contact email (`REPORT_EMAIL`, `site/`, Play
   contact, `play-listing.md`); the IARC question sent on 2026-10-29 is moot unless they answer.

## 3. Timeline and why things are the way they are

- **2026-10-28/29 — No Play services.** Android location moved to `modules/nomad-location` (system
  `LocationManager`); expo-location left out of Android autolinking; Firebase and the Install Referrer excluded
  by config plugins. Reason: GPL next to libkiwix (rule 3).
- **2026-10-29 — First submission.** App created; listing, App content forms; Health apps declared "Emergency and
  First Aid" + "Medical Reference and Education"; content rating PEGI 18; audience 18+. Closed test 1.1.0 (24)
  sent to review.
- **2026-10-29 — Rejected.** "Some types of apps can only be distributed by organizations": our Health apps
  categories require an organization account. Declaring "no health features" with the same binary would have been
  misrepresentation (risk for the whole account, Theri.App included).
- **2026-10-29 — Play support ticket.** Their answer: to ship from a personal account, remove the downloadable
  medical and first-aid archives, make sure the AI gives no medical answers, remove first-aid instructions and
  health guidance from preparedness; then declare no health features. Emergency numbers and the map's hospitals
  and pharmacies are fine as general utility.
- **2026-10-29 — Android without health** (commit 4a7d6d3, versionCode 25 in 4b29205). Owner's choices: the
  assistant gives a fixed reply to health questions; the plan's health card is hidden; of the survival archives
  only "Después del desastre" (mostly first aid) is hidden; the kit's health supplies stay (a shopping list, like
  Ready.gov's).
- **2026-10-29 — Listing redone.** Descriptions without first aid or medicine; 8 + 8 Android screenshots redone;
  Health apps → none; content rating redone with violence, language and drugs "no" (owner: rate it like Kiwix
  and Wikipedia, which are PEGI 3 with the same content) → PEGI 3; audience back to 13+.
- **2026-10-29 — Build 26** (47f4a42, e25bef1). Shooting the screenshots showed the no-health prompt made the model
  refuse water questions, and the empty assistant screen still mentioned health. Fixed and checked with the real
  model (section 4, "Assistant").
- **2026-10-30 — Closed test resubmitted** with 1.1.0 (26).

## 4. Health gate (`HEALTH_FEATURES`)

`src/lib/health.ts`: `export const HEALTH_FEATURES = Platform.OS !== 'android';` — iOS keeps everything.

### What is off on Android, and where

| Area | Behaviour on Android | Code |
|---|---|---|
| Catalog | No `medicine` category, no resource with `medical: true`, no `subject: 'health'` course, no `zimgit-post-disaster_en` ("Después del desastre") | `features/catalog/health-core.ts` (`withoutHealth`, `FIRST_AID_ARCHIVES`; pure, tested), applied in `features/catalog/index.ts` |
| Explore (Kiwix OPDS) | Hides catalog health ids and anything `looksMedical` | `app/(tabs)/library/explore.tsx`, `features/catalog/index.ts` (`isHiddenHealthBook`), `features/library/medical.ts` |
| Home | Survival guides shortcut (`home-guides`, Tent icon) instead of first aid (`home-first-aid`) | `app/(tabs)/(home)/index.tsx` |
| Readiness | Points to the survival category instead of medicine | `features/home/readiness.ts` |
| Onboarding | Welcome, guides and plan texts without medicine (`*NoHealth` keys) | `app/onboarding.tsx` |
| Plan | No health card (medication, allergies, blood type); hub text `hub.planEmptyNoHealth` | `app/(tabs)/(home)/prepare/{index,plan}.tsx` |
| Assistant | A health question gets a fixed reply with the emergency number; the system prompt forbids treatment and first-aid steps; knot starter instead of burn; empty-screen disclaimer without health | `features/assistant/rag-core.ts` (`isHealthQuestion`, `noHealthAnswer`, `NO_HEALTH_NOTE`), `features/assistant/chats.ts`, `app/(tabs)/assistant/index.tsx` |

### What stays on Android (and why it's allowed)

Emergency number per country and the call button; the map's hospitals and pharmacies (Play support: general
utility); the kit's health supplies (shopping list); Ready.gov and CD3WD archives; Wikipedia (general
encyclopedia, like the Kiwix and Wikipedia apps); the reader's "not medical advice" banner.

### Assistant details (the part most likely to regress)

- `isHealthQuestion(question)` is a word-prefix keyword match (`HEALTH_TERMS` in `rag-core.ts`, es + en, normalized without accents; `NOT_HEALTH` lists words that only look medical). It
  also catches emergencies that name no condition ("me he cortado", "swallowed bleach", fainting, choking,
  seizures…). Watch false positives: "vendaval", "corto leña", "potabilizo agua", "paint", "medición", "sangría",
  "picadillo", "burner" must stay **false** (asserted in `rag-core.test.ts`).
- On Android a health question never reaches the model: `chats.ts` returns `noHealthAnswer(lang, emergencyNumber)`.
- Everything else gets `NO_HEALTH_NOTE` in the system prompt. Its wording matters: an earlier, broader one ("don't
  give health advice") made small models refuse water questions or append "see a doctor". The current one forbids
  only medical treatment and first-aid steps and says water, food, shelter, fire and hygiene are **not** health.
- **Changing the prompt or the terms → check with a real model**, not just unit tests: run `llama-server`
  (Homebrew) with Qwen3.5 2B/4B GGUFs and a small node script that imports `rag-core.ts` (`systemPrompt`,
  `buildRagUserMessage`, `isHealthQuestion`) and asks the same questions 3 times each with the old and new prompt
  (water, fire, a cut, a poisoning, in es and en). Expect clean water answers and no first-aid steps.

### Adding anything new about health, medicine or first aid

1. Gate it: `import { HEALTH_FEATURES } from '@/lib/health'` (pure `*-core.ts` modules take it as a parameter, as
   `systemPrompt(…, { noHealth })` does).
2. New catalog resources: tag them `medical: true`, category `medicine` or subject `health`, or add the id to
   `FIRST_AID_ARCHIVES` if it's mostly first aid under another category. Add a test in `health-core.test.ts`.
3. New copy that mentions health: add a `…NoHealth` i18n key in es and en for Android.
4. New assistant starters or prompts: no health topic on Android; re-run the model check above.
5. Run the Android tour (`npm run e2e:android`) and look at the changed screens on the emulator.
6. If it's visible in the listing or screenshots, keep them free of health content (`play-listing.md`).

### Bringing health back on Android (only if the owner ever gets an organization account)

Organization account (D-U-N-S number) → update the Health apps declaration → `HEALTH_FEATURES` true on Android in a
**new release** → new listing texts/screenshots → redo the content rating (medical guides with injury photos gave
PEGI 18). Never through a remote switch.

### Known limitation

An update from 23/24 (internal testers only) keeps medical archives that were already installed; they stay readable
under the "not medical advice" banner. Fresh installs (reviewers, closed testers) never see them.

## 5. Other Play requirements and how we meet them

| Requirement | How | Where / check |
|---|---|---|
| No proprietary code next to GPL libkiwix (owner's rule) | Location without Play services; Firebase and Install Referrer excluded; ML Kit GenAI removed | `modules/nomad-location`, `src/lib/location.ts` (ESLint bans `expo-location` elsewhere), `plugins/with-android-no-firebase.js`, `plugins/with-android-no-install-referrer.js`, `package.json` (expo-location out of Android autolinking). Check: `./gradlew :app:dependencies --configuration releaseRuntimeClasspath \| grep -i 'gms\|installreferrer\|firebase'` is empty |
| AI-generated content: users can report offensive output | "Report answer" flag under each finished answer (Android only) opens the mail app with the answer | `features/assistant/report-core.ts`, `features/assistant/ui/Message.tsx`; privacy policy mentions it |
| Minimal permissions | `SYSTEM_ALERT_WINDOW` and storage permissions blocked. Left: location, network, notifications + boot (kit reminders), microphone, vibrate | `app.json` › `android.blockedPermissions`. Check: `bundletool dump manifest --bundle=<aab>` |
| 16 KB page support (Android 15+) | Every `.so` aligned | `llvm-objdump -p <lib>.so \| grep LOAD` (`2**14`+), `zipalign -c -P 16` |
| 64-bit, size limit | arm64-v8a + x86_64 only (llama.rn has no 32-bit); ~90 MB download on arm64 (limit 200 MB) | `expo-build-properties` `android.buildArchs` |
| Data safety | "No data collected": everything is on-device; downloads send only the request | `play-listing.md`, must match `site/privacy.html` |
| Open-source notices | Full transitive Android notices in Credits › Android libraries | `scripts/licenses/android-deps.mjs` then `node scripts/licenses.mjs` |
| Auto Backup | Only the user's own data (SQLite folder, kv-store) goes to Google Drive backup; re-downloadable content stays out (cloud backup skips an app over 25 MB) | `plugins/with-android-backup-rules.js` |

## 6. Release procedure (Android)

1. **Code ready**: `npx tsc --noEmit`, `npx expo lint`, `npm test`, `npm run check:i18n`; Android tour
   (`npm run e2e:android`, VPN off: GlobalProtect breaks the emulator's network). Health-related change → section 4
   checklist.
2. **Bump** `android.versionCode` in `app.json`; update the "currently" line in `docs/RELEASE.md`; commit.
3. **Build** from a clean tree at that commit (`docs/RELEASE.md`, "Build an upload"):
   `NOMAD_STORE_BUILD=1 npx expo prebuild --platform android --clean --no-install`, then
   `cd android && ./gradlew :app:bundleRelease` with `JAVA_HOME` set to Android Studio's jbr.
4. **Verify the AAB**: versionCode; upload certificate SHA-256 `FE:91:1E:57:…:08:58` with
   `"$JAVA_HOME/bin/keytool" -printcert -jarfile <aab>` (the system `keytool` fails: ivm config); permissions
   unchanged (`bundletool dump manifest`). Copy it to `~/Downloads/nomadpocket-<version>-<versionCode>.aab`.
5. **Tag** `v<version>-android-<versionCode>` (local; push only when the owner says).
6. **Play Console** (section 7): new release on the track → owner uploads the AAB → agent fills the release notes →
   «Siguiente» → «Guardar» → check the publishing overview lists the new versionCode → owner clicks
   «Enviar cambios a revisión».
7. **Docs**: `docs/PROGRESS.md` log + status row, section 2 of this file, `play-listing.md` if a form changed,
   the agent's memory.

## 7. Play Console: navigation and gotchas

Base URL: `https://play.google.com/console/u/0/developers/5502748653724108225/app/4972946077817579435/`

| Page | Path |
|---|---|
| Publishing overview (where changes are sent to review) | `publishing` |
| Closed testing list | `closed-testing` (then «Gestionar canal» on "Prueba cerrada - Alpha"; track id 4700400339500154430, `tracks/4700400339500154430`) |
| Store listing (es-ES default) | `store-listings/default/edit` |
| Content rating | `app-content/content-rating-overview` |
| Target audience | `app-content/target-audience-content` |
| Policy status (rejection reasons) | Policy and programs › Policy status |

Gotchas seen so far:

- **Publishing is not managed** («Publicación gestionada desactivada»): saving a release or a form only queues it in
  the publishing overview. Nothing reaches Google until «Enviar N cambios a revisión». After sending, Play runs
  quick checks (up to ~15 min) and then submits on its own.
- **A rejected release can't be edited into a new one**: use «Crear nueva versión» on the track. The old bundle shows
  as "No incluido" (good: don't click «Incluir»).
- **A release saved as a draft doesn't replace the old one in the overview.** Go through «Siguiente» → «Revisar y
  confirmar» → «Guardar»; then the overview shows the new versionCode. Always check it there before sending.
- **Release notes textarea** is pre-filled with a real template (`<es-ES>Introduce o pega…</es-ES><en-US>…`), not a
  placeholder: select all and replace. Format: `<es-ES>\n…\n</es-ES>\n<en-US>\n…\n</en-US>`.
- «Guardar como borrador» stays disabled until a bundle is attached; leaving the page before the upload loses typed
  notes.
- The track page sometimes renders scrolled sideways (content cut on the left); a reload or `scrollLeft = 0` fixes it.
  Some deep URLs (`tracks/closed-testing`) error: go through `closed-testing`.
- Screenshots: upload one at a time through the panel's hidden file input; they're added in order. Deleting several:
  the refs change after each delete, so click `button[aria-label^="Quitar 0"]` in a loop. An en-US listing with no
  screenshots shows the es ones faded (inherited): upload its own set.
- Content rating questionnaire: category "Todos los demás tipos de aplicaciones"; answers in `play-listing.md`. The
  owner ticks the IARC terms box.
- Target audience checkboxes shift the layout after a click: take a new screenshot before the next click.

## 8. Store assets for Android

- Screenshots: `docs/store/marketing/<lang>/android/01…08` (1080 × 1920, from the `Nomad_Shots` AVD in demo mode),
  captions in `scripts/store-screenshots.py` (`ANDROID_CAPTIONS`, `caption_for`). They must show no health content
  (04 is a survival guide, not first aid).
- Icon 512 px and feature graphics 1024 × 500: `docs/store/play/`.
- Texts: `docs/store/play-listing.md` (Play has no subtitle or keywords; the short description does that job).
