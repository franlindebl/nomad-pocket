# Contributing to Nomad Pocket

Ideas, bug reports, translations and pull requests are welcome, in English or Spanish. For
anything bigger than a small fix, open an issue first so we agree on the direction before you
spend time on it. Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Licence and distribution (please read)

- Nomad Pocket is **GPL-3.0-or-later** (see [LICENSE](LICENSE)). By opening a pull request you
  confirm that you wrote your contribution (or have the right to submit it) and you license it
  under GPL-3.0-or-later, like the rest of the code. There is no CLA.
- The maintainer distributes the app through the **Apple App Store and Google Play**, and
  contributions become part of those store builds. By contributing you accept that. If you are
  not comfortable with your code being distributed through those stores, please don't contribute
  it. (This note is about the project's own code; the third-party libraries in the builds keep
  their own licences, listed in the app under Settings › Credits & licenses.)
- Copyright line of the project: "Copyright (C) 2026 Fran Linde Blázquez and contributors".
- Data you add (catalog entries, fixtures, translations) must be under a licence compatible with
  that distribution, and third-party files need a note on their source and licence (see
  `e2e/fixtures/README.md`).

## Building from a clean clone

You don't need any of the maintainer's accounts to build, run and test on a simulator or
emulator.

```bash
git clone https://github.com/franlindebl/nomad-pocket && cd nomad-pocket
npm install            # also fetches the libkiwix and Valhalla iOS frameworks (macOS only)
npx expo run:ios       # dev build on a simulator (macOS, Xcode with an iOS simulator runtime)
npx expo run:android   # or on an emulator (Android Studio; use its bundled JDK as JAVA_HOME)
npm start              # Metro only, for an app that is already installed
```

Expo Go won't work: the app has its own native modules. `ios/` and `android/` are generated
(`npx expo prebuild`) and git-ignored; configure native behaviour in `app.json`, the config
plugins in `plugins/` and `modules/*`, never by hand in those folders. Details, gotchas
(SwiftPM and the Keychain, the JDK) and release builds: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

On a **physical iPhone** you need your own Apple team and a bundle id that is yours: the
`com.fjlinde.nomadpocket` id is registered to the maintainer. Change `ios.bundleIdentifier` in
`app.json` locally (don't commit that change) and sign with your team. Some entitlements of the
production build (extended virtual addressing for big models) are only added to production builds
and may not be available to a free developer account. Simulators and emulators are unaffected.

## Before you open a pull request

The pre-commit hook (installed by `npm install`) runs the first four checks, about 5-10 s:

```bash
npx tsc --noEmit
npx expo lint
npm test                 # unit tests, node --test with type stripping
npm run check:i18n       # every t('...') key exists in es and en
```

Also, when they apply:

- Add a `*.test.ts` next to any pure logic you add or change (the pure modules listed in
  [CLAUDE.md](CLAUDE.md) load without the `@/` alias).
- `npm run check:catalog` after editing `src/data/catalog.json`.
- `node scripts/licenses.mjs` after changing dependencies or `scripts/licenses/native.json`
  (`--check` fails on a stale `src/data/licenses.json`).
- Look at UI changes running (Release build on a simulator, light and dark) and run the Maestro
  suite if you touched a flow it covers: [docs/E2E.md](docs/E2E.md).
- Every user-facing string goes through i18next in both `es` and `en`; use the design system in
  `src/components/ui` and theme tokens: [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md).
- Match the surrounding code: a short header comment per file, comments for the non-obvious
  *why*, Prettier (`.prettierrc`). Architecture and conventions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commits and pull requests

- English, imperative title in the form `Area: what changed` (for example `Maps: ship Hebrew and
  Arabic glyphs`), with a body that explains why.
- One coherent change per commit, and a pull request per topic against `main`. Keep your branch
  rebased (linear history). Describe how you checked it and on which platform.
- If your change alters behaviour, contracts or user-visible limits, update the matching page in
  `docs/` (and `docs/PROGRESS.md` for status and known issues) in the same pull request.

## Good places to start

- Reproduce a bug on your phone and open an issue with the steps.
- Translations (`src/i18n/locales`) and catalog suggestions (`src/data/catalog.json`).
- Countries without offline routing (`scripts/routing/packs.json`).
