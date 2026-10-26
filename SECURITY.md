# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue or pull request:

1. Open the repository's **Security** tab on GitHub.
2. Choose **Report a vulnerability** (GitHub's private vulnerability reporting).

Include what you found, how to reproduce it (app version and build, platform, steps or a proof
of concept) and what you think the impact is. If you can't use GitHub, email
fran.linde.blazquez@gmail.com with "Nomad Pocket security" in the subject.

This is a one-person open-source project. I'll read every report and aim to acknowledge it within
about a week and to tell you what I plan to do about it; I can't promise fixed response or fix
times. Please give me a reasonable chance to ship a fix before you disclose publicly, and tell me
if you want to be credited.

## What is in scope

- The app (`src/`) and its native modules (`modules/nomad-zim`, `modules/nomad-llm`,
  `modules/nomad-route`) on iOS and Android: for example the reader's sandbox for archive pages,
  how downloaded files are verified and stored, the local databases, deep links and what leaves
  the device.
- The CI that builds and publishes the country packages (`.github/workflows/`, `scripts/maps/`,
  `scripts/routing/`): anything that could make the published maps, routing packs or catalogs
  carry content the workflow didn't build, or leak the repository's credentials.
- The privacy site (`site/`).

## What is not

- Vulnerabilities in third-party servers the app downloads from (Kiwix and its mirrors,
  Protomaps, Overpass, Hugging Face, GitHub) or in the libraries and models it bundles: report
  those upstream. If the app uses them unsafely, that is in scope.
- Map, emergency-point or guide content that is wrong or out of date (open an ordinary issue),
  and attacks that need a rooted or jailbroken device or physical access to an unlocked one.

## Supported versions

Only the latest App Store / TestFlight release (and the `main` branch) gets fixes.
