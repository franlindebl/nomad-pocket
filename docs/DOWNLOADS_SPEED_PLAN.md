# Faster downloads: analysis and plan

Status: **analysis only** (2026-10-26; Kiwix, GitHub, Hugging Face and Protomaps measured). Nothing implemented. Pick it up **after `audit-fixes`
is merged into `main`**: that branch rewrites `src/features/downloads/manager.ts`
(network gate, retries that keep the bytes, sha-256 check, `avoidMirrors`), and this plan
builds on that version. The references below are to `audit-fixes` unless they say `main`.

## The problem

The owner's report: the complete Spanish Wikipedia without images
(`wikipedia_es_all_nopic`, 13.3 GB) showed an estimate of about 2 hours on a fast
connection. That is about **1.8 MB/s**.

The three requests:

1. Faster downloads: several connections in parallel, using the mirrors that are fastest
   at downloading (not the ones that answer first).
2. Resume half-finished downloads.
3. Keep the screen on while something downloads and the app is open.

## How downloads work today

- One `DownloadTask` (expo-file-system 58) per file: an iOS background `URLSession`, or
  OkHttp on Android. At most 2 files at a time (`MAX_CONCURRENT`).
- `fastestMirror()` (`downloads/mirrors.ts`) reads the file's `.meta4` metalink, takes the
  **first 4** https mirrors by priority, times a **512 KB** range request at **offset 0** on
  each (5 s timeout) and keeps the quickest. It decides once, before the first byte. A
  resumed transfer keeps that URL: iOS resume data is tied to its request.
- On `audit-fixes`, the metalink's size and sha-256 are also kept. The finished file is
  hashed, and a bad copy is deleted and its mirror avoided on the retry. Network errors and
  5xx keep the bytes and retry with a backoff (`planAfterFailure`, `manager-core.ts`).

Timing 512 KB from the start of the file measures connection setup, TLS, TCP slow start and
whatever the mirror has cached. It doesn't measure sustained throughput, which is what a
multi-GB download needs. The owner's suspicion is right (data below).

## Measurements (2026-10-26)

From the development Mac in Spain, with curl, file `wikipedia_es_all_maxi_2026-10.zim`
(36.5 GB, its metalink lists 8 https mirrors). For each mirror: the time for 512 KB at
offset 0 (what the app measures), then speed over 3 s and 8 s at a random offset deep in the
file, then 4 parallel connections. Two rounds a few minutes apart. Scripts:
`probe.sh`/`probe2.sh` in the session scratchpad (easy to rewrite: curl `-r <range> -m <s>
-w '%{speed_download}'`).

| Mirror (metalink priority) | 512 KB, r1 / r2 | 1 conn, r1 (8 s) | 1 conn, r2 (3 s / 8 s) | 4 conn, r1 |
|---|---|---|---|---|
| 1 mirror.download.kiwix.org (fr; the load balancer's target) | 1.56 s / 0.53 s | 0.3 MB/s | 1.2 / 0.5 MB/s | 1.9 MB/s |
| 2 ftp.nluug.nl (nl) | 1.67 s / **0.35 s** | 6.5 MB/s | 7.4 / 3.5 MB/s | 9.4 MB/s |
| 3 mirrors.dotsrc.org (dk) | 0.73 s / 0.55 s | **19.3 MB/s** | 17.0 / 12.5 MB/s | **28.8 MB/s** |
| 4 mirror.accum.se (se, redirects to chuangtzu.ftp.acc.umu.se) | – / 0.89 s | – | 14.4 / **23.1 MB/s** | – |
| 5 ftp.fau.de (de) | **0.33 s** / 0.45 s | 2.4 MB/s | 3.0 / 4.0 MB/s | 6.0 MB/s |
| 6 www.mirrorservice.org (gb) | 0.41 s / **0.24 s** | 1.8 MB/s | 8.5 / 4.7 MB/s | 5.4 MB/s |
| 7 wi.mirror.driftle.ss (us) | 4.07 s / 1.84 s | 8.8 MB/s | 5.2 / 8.7 MB/s | 13.1 MB/s |
| 8 dumps.wikimedia.org (us) | 5.69 s / 0.70 s | 1.1 MB/s | 1.8 / 2.1 MB/s | 3.0 MB/s |

(r1 didn't follow accum.se's redirect. The app's `fetch` does follow it.)

Aggregates in round 2, over 10 s: 3× dotsrc + 3× driftless + 2× nluug = **36.2 MB/s**;
8× dotsrc = **39.0 MB/s**. Both hit the Mac's link, not the mirrors.

What the numbers say:

1. **The 512 KB time doesn't predict speed.** The quickest to 512 KB were mirrorservice
   (0.24 s → 4.7 MB/s), fau (0.33 s → 2.4 MB/s) and nluug (0.35 s → 3.5 MB/s). accum.se
   took 0.89 s and then gave 23 MB/s. In round 2 today's code (first 4, quickest 512 KB)
   would have chosen nluug at 3.5 MB/s over accum.se at 23 MB/s: **6.6× slower**.
2. **Only the first 4 are tried.** Priorities come from geolocating the client's IP, and
   fast mirrors (driftless, 5th to 8th) are never considered.
3. **Speeds drift within minutes**: dotsrc 19.3 → 12.5, nluug 6.5 → 3.5, mirrorservice
   1.8 → 4.7 MB/s. A choice made once at the start of a 1–2 h download goes stale.
4. **Mirrors limit each connection.** The priority-1 mirror (also where
   `download.kiwix.org` redirects) gives 0.3–0.5 MB/s per connection and 1.9 MB/s with 4
   connections. Every mirror gains from more connections: dotsrc gives 19 MB/s with 1, 29
   with 4 and 39 with 8.
5. With about 8 connections spread over good mirrors, **the person's own link becomes the
   limit**.

What this means for the 13.3 GB file: today ~2 h (~1.8 MB/s). One connection to the right
mirror (~15 MB/s): ~15 min. 8 connections (~36 MB/s on this link): ~6 min. Phone Wi-Fi is
usually slower than this Mac, but we can still expect 5–10× faster downloads.

Caveats: these were measured with curl on a Mac, not on a phone, and metalink priorities
depend on the client's IP. The device spike (below) must measure again.

Also useful: every Kiwix metalink lists **4 MiB sha-1 piece hashes** (`<pieces
length="4194304" type="sha-1">`, 8,707 pieces for es maxi) and the whole file's md5, sha-1
and sha-256.

## Plan

Four independent pieces, in this order. Each one helps on its own.

### A. Keep the screen on while downloading (small; can go first)

- `expo-keep-awake` is already a dependency. `maps/guidance.ts` and `maps/extraction.ts`
  use tags with `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)`.
- New `downloads/keep-awake.ts`, wired from the downloads init: subscribe to `useDownloads`
  and `AppState`. While any record is `running` (URL downloads and external jobs), and the
  app is active, hold the tag `downloads`. Release it otherwise. Queued records waiting for
  Wi-Fi don't count.
- Why it matters beyond comfort: **on Android, locking the screen pauses every download**
  (the app goes to background and the manager snapshots and pauses the transfers). On iOS
  the single background task keeps going, but the parallel engine (C) only runs at full
  speed in the foreground.
- UX: one line in the Downloads sheet while it applies ("La pantalla se mantendrá
  encendida mientras se descarga" / "The screen stays on while downloading"), es + en.
  Optional: a Settings toggle, on by default. Brightness is left alone.

### B. Pick mirrors by throughput (small–medium, low risk)

In `mirrors.ts` (keep it pure and tested):

- Candidates: **all** https mirrors in the metalink, not the first 4.
- Probe = **throughput after the first byte**: a range request of up to 16 MiB at a
  random offset (the metalink gives the size), counting bytes for ~2 s from the first
  byte, then abort. `expo/fetch` streams the response body (`response.body.getReader()`).
  A `DownloadTask` with `onProgress` plus `cancel()` would also work. Score = bytes/s.
  Keep the existing guard: anything other than a 206 is dropped unread.
- Probe all candidates at once (~2.5 s in total). They share the link, which compresses
  the ranking but keeps it in order, and C corrects it while downloading anyway.
- Remember scores per host (kv-store, decaying over ~24 h). The next download orders
  candidates by them and can probe only the top few.
- Score the host that actually serves the file (accum.se redirects elsewhere).
- Without C this alone should take the 13 GB case from ~2 h to roughly 15–30 min.

### C. Segmented, multi-mirror engine (large; the real gain)

Used when the size is known (metalink, a manifest or a HEAD request), the server answers
ranges with 206, and the file is above ~64 MB. Everything else keeps today's single
`DownloadTask`. Sources: the Kiwix mirrors. GitHub Releases (maps, routing packs) and
Hugging Face (models) take ranges too, so several connections to their single URL also
help.

- **Chunks**: fixed 32 MiB, a multiple of the metalink's 4 MiB pieces. Each chunk is a
  `DownloadTask` with `headers: { Range: 'bytes=a-b' }` (supported by expo-file-system 58)
  written to `partial/<id>.chunks/<n>`.
  Guard: if `onProgress` reports a `totalBytes` other than the chunk's length, cancel at
  once. iOS accepts any 2xx (`FileSystemDownloadTask.swift`), so a mirror that ignores
  `Range` would otherwise send the whole file into one chunk.
- **Connections**: up to 8 in total on Wi-Fi (4 on allowed mobile data), and at most 3 per
  mirror. The mirrors are volunteers' servers: spread the load across them rather than
  hammering one. The next chunk is always the lowest missing index, so the file fills
  front to back and few chunks are in flight.
- **Scheduler** (pure `segments-core.ts`, unit-tested):
  - Mirror score = moving average of per-connection throughput over its finished chunks,
    seeded from B.
  - A free connection takes the best mirror that still has a free slot.
  - An unmeasured mirror gets one chunk now and then, so it can prove itself.
  - Two errors in a row bench a mirror for a few minutes. A chunk that failed retries on
    another mirror.
  - Endgame: when an in-flight chunk would finish much later than the best mirror could
    fetch it (e.g. 3×), start a duplicate there and keep whichever ends first. This
    prevents the last chunks from waiting on a slow mirror.
  - This replaces the "one choice at the start": scores follow the mirrors as they drift
    (measurement 3).
- **Assembly**: a finished chunk is written at its offset into `partial/<id>.part` (a
  sparse file), then deleted. v1 uses expo-file-system's `FileHandle` (`file.open()`,
  `offset`, async `readBytes`/`writeBytes`) in 4 MiB slices. If the device spike shows it
  slow or janky, add a native `copyRange(src, dst, offset)` to a local module (Swift
  `FileHandle`, Kotlin `FileChannel`). Extra space needed: about connections × chunk size
  (~256 MB) beyond the file itself.
- **Integrity**: keep the whole-file sha-256 at the end (`audit-fixes`). Later (D), use the
  piece hashes to find and refetch only the bad 4 MiB pieces, and to know which mirror sent
  them.
- **Persistence and resume**: store a bitmap of finished chunks with the download (a new
  `segments` column through a migration, or `meta`), written as chunks land. After a
  relaunch on either platform, **even after iOS killed the app**, it continues from the
  chunks already in `.part`. Only in-flight chunks are lost, at most 8 × 32 MiB.
- **Pause** = cancel the in-flight chunks. **Resume** = schedule the missing ones. There
  is no per-chunk resume data: Android's resume rewrites the header to `Range:
  bytes=<offset>-` (`FileSystemDownloadTask.kt`), which would break a chunk's range.
- **Progress and speed**: sums over the chunks. The record's `speed` is unchanged for the UI.
- **Queue**: a segmented file already fills the link, so count connections globally rather
  than files (or run one segmented file at a time).
- **Network gate / Wi-Fi only**: same rules as `audit-fixes`. Holding a download cancels
  its chunks and keeps the bitmap.

**Background behaviour:**

- Android: unchanged (transfers stop with the process). On background, cancel the chunks
  and persist the bitmap. On foreground, continue. With A this only happens when the
  person leaves the app. A foreground service for real background downloads is a separate,
  bigger item.
- iOS: once the app is suspended, JS can't start new chunks. Proposal: on `background`,
  let the in-flight chunks finish (they are background-session tasks), and queue a
  "background reserve": the next missing ranges as a few big tasks (e.g. 4 × 1 GiB).
  On foreground, take what finished and treat what's still running as in-flight chunks.
  If the spike shows iOS throttles tasks created at that moment, the fallback is today's
  behaviour: one background task from the first missing byte to the end.

### D. Piece-level repair (medium, native; after C)

A native helper that sha-1-hashes 4 MiB ranges of a file (iOS CommonCrypto, Android
`MessageDigest`). If the final sha-256 fails, hash the pieces, refetch only the bad ones
from a different mirror, and add that mirror to `avoidMirrors`. Today a bad copy means
downloading all 13–36 GB again.

## Resuming: what each version does

| Situation | `main` | `audit-fixes` | With C |
|---|---|---|---|
| Person pauses / resumes | Continues (iOS resume data, Android `.part`) | Same | Continues from the finished chunks |
| Network drop, 5xx | Failed. Retry usually starts from zero | Keeps the bytes, retries by itself (5 s, 30 s, 2 min) | Only the chunk retries, on another mirror. The rest keeps going |
| App killed, iOS | **Starts from zero.** The orphaned background task keeps downloading alongside | Same | Continues from the finished chunks |
| App killed, Android | Starts from zero unless a background snapshot exists | Continues from the `.part` | Continues from the finished chunks |
| Screen locked, Android | **Pauses** | Pauses | With A: doesn't happen while the app is open |
| Bad file (hash) | — | Deleted. Retry downloads it all from another mirror | Same. With D, only the bad pieces |

## Other downloads: courses, maps, routing packs, models

Measured the same day (18:00 UTC), from the same Mac. The link peaked at ~30–39 MB/s.

| What | Comes from | Size | How it downloads today |
|---|---|---|---|
| Courses, medicine, survival, DIY, books; anything from Explore | `download.kiwix.org` + metalink mirrors (Explore's OPDS links are the same `.zim` URLs, `.meta4` stripped) | 101 catalog items (372 GB), 42 over 1 GB. Courses: 14 items, 11 GB, biggest 2.6 GB. TED conference: 18 GB | Same path as Wikipedia |
| Country maps | GitHub Releases → `release-assets.githubusercontent.com` | 241 countries, median 118 MB. Spain 2.29 GB in 2 parts; largest 8.5 GB (Canada) in 5 parts of ≤ 2 GiB | Manager, one group of files, 2 files at a time, sha-256 from the manifest |
| Routing packs + search files (points, streets, places, addresses) | GitHub Releases | Spain: 2.27 GB in 2 parts + TSVs | Same |
| AI models | Hugging Face → `us.aws.cdn.hf.co` | 0.53–3.1 GB (4 models) | Manager |
| Map extraction (fallback for a country the catalog lacks) | `build.protomaps.com` (planet, 139 GB) | A region | External job: its own range requests, 4–6 at a time, ≤ 4 MiB each, keep-awake already |
| Manifests, OPDS feeds, Overpass (emergency points) | Various | KB–MB | `fetch`. Nothing to gain |

| Source | 1 connection | 4 | 8 |
|---|---|---|---|
| GitHub Releases, `es.pmtiles.part00` | 16.4 MB/s (again: 15.9) | 18.1 | 24.1 |
| GitHub Releases, `es.tar.part00` | 16.1 MB/s | 26.7 | 28.1 |
| Hugging Face, Qwen3.5-2B | 27.8 MB/s (again: 29.6) | 26.7 | 27.9 |
| Protomaps planet build | 28.2 MB/s | 29.5 | 30.0 |
| *For comparison, Kiwix: best mirror / default mirror* | *12–23 / 0.3–0.5* | | |

What this means:

1. **Courses and every other Kiwix archive have Wikipedia's problem**, and the same fix
   covers them. A–D apply as they are, Explore included. Nothing extra to build.
2. **GitHub (maps, routing packs)**: one connection gives ~16 MB/s, about half this link,
   and 4–8 connections reach the link (~1.6×). A country already downloads 2 files at a
   time, so it runs near link speed except at the end, when one big part is left alone.
   Spain (~4.7 GB) takes ~3–4 min on this link. C would gain maybe 20–30% there: not a
   reason to build C, but once C exists, GitHub assets over ~64 MB can use it with 4
   connections at little cost. Check on the device first.
3. **Hugging Face and Protomaps**: one connection already fills the link. C gains nothing
   in speed. (Extraction's own parallel requests are about latency, and they already
   exist. Its resume after a kill is backlog item 4 in PROGRESS.)
4. **Maps and models need robustness, not speed:**
   - A (keep-awake) covers them too: today, locking an Android phone pauses a country
     download as well.
   - **Signed redirects expire after 1 h.** GitHub's redirect URL carries `se=` about an
     hour ahead, Hugging Face's `Expires=` exactly 1 h ahead. To verify on iOS: resume
     data after a pause longer than an hour probably points at the expired URL. The
     server would answer 403, which `audit-fixes` treats as stale resume data, so the
     download restarts from zero (a 2 GB part, a 3 GB model). Android resumes from the
     original URL (a fresh redirect), so it is fine. C avoids this: every chunk asks the
     original URL. Without C: on a 4xx when resuming on iOS, retry once with a new task to
     the original URL before throwing the bytes away. The bytes live only in the resume
     data, so check whether expo-file-system lets us swap the URL in it.
   - A kill on iOS restarts the current file from zero (≤ 2 GiB for maps, ≤ 3.1 GB for
     models). Either C or PROGRESS backlog item 3 (reattach the background `URLSession`)
     fixes it.

Recommendation: the order stays A → B → spike → C → D. A covers every kind from the
manager at once. B is Kiwix-only (it needs the metalink). Build C with a source that is a
**list of URLs**: Kiwix gives several mirrors; GitHub and Hugging Face give one URL with
several connections. Turn it on for Kiwix first, for GitHub assets if the spike shows a
gain, and for models only if a device measurement says so.

## Device spike before C (half a day)

On a real iPhone and an Android phone, Release build, behind a debug flag:

1. 8 ranged `DownloadTask`s at once, across 3 mirrors, in the background session and in
   the foreground session. Measure the total MB/s, task start latency and whether iOS caps
   connections per host. Compare with B's single connection.
2. `FileHandle` copy speed of 32 MiB chunks into a sparse file, and JS thread stalls
   (a frame drop counter or a scroll test).
3. iOS: go to background mid-download. Check what the reserve tasks do over 10 minutes and
   what is left when the app comes back.
4. Run B's probe on the phone: compare its ranking with the sustained speeds.
5. iOS: pause a GitHub map part and a Hugging Face model for more than an hour, then
   resume. Does it get a 403 and start from zero? Also: GitHub with 1, 4 and 8 connections
   from the phone.

For repeatable tests without real mirrors, a small Node "mirror simulator" (`scripts/`)
can serve one file on several ports, with a per-connection speed limit, random 5xx and a
port that ignores `Range`. The scheduler's unit tests can use the same scenarios.

## Files it will touch

- `src/features/downloads/keep-awake.ts` (A), the downloads init, i18n `downloads` es/en.
- `src/features/downloads/mirrors.ts` + `mirrors.test.ts` (B).
- `src/features/downloads/segments-core.ts` + test (C, pure), `segmented.ts` (transport,
  assembly), `manager.ts` (`run()` picks the path; pause/cancel/hold/background for
  segmented records), a DB migration if the bitmap gets its own column.
- Docs: ARCHITECTURE (Downloads contract), PROGRESS, DEVELOPMENT (mirror simulator), E2E
  if a flow needs a `testID`.

## Open questions

- Kiwix's policy on parallel connections to its mirrors. Kiwix's own apps download through
  aria2 (libkiwix's downloader) with the metalink: check which per-server limits they
  pass. Up to 3 per mirror seems polite. Worth asking upstream before shipping.
- Mobile data: same engine with fewer connections, or single-connection only?
- GitHub and Hugging Face: measured above. Kiwix first, GitHub if the device spike shows a
  gain, Hugging Face only for resume robustness. To verify on iOS: resuming after the
  signed redirect has expired (> 1 h paused).
