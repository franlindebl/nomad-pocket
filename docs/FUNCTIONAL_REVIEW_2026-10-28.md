# Functional review — 2026-10-28

Bug hunt on the iOS simulator, driving the app as a person would (axe), in Spanish and English and in
several countries. Build: Release of `332b8ad` against the live catalogs (no `EXPO_PUBLIC_*` overrides).
Each item says how to reproduce it, what is known about the cause, and when it counts as fixed. Status
of each fix is tracked at the end.

## Setup used

| Simulator | UDID | Locale / region | Content | Location |
|---|---|---|---|---|
| `NP-review` | `15C6708C-BA3B-4132-BE76-B63882C00508` | es-ES / ES (metric) | Spain kit (map + routing + 12 guides + Spanish Wikipedia nopic 13 GB), Israel, Apple Intelligence; family plan with meeting point "Parque del Retiro, Puerta de Alcalá" + details "Si no nos localizamos, allí a las 18:00", contact Ana López, person Lucas (Ventolin, penicillin allergy, A+) | Madrid 40.4168,-3.7038 |
| `NP-review-en` | `FBFF71B0-75D9-4F93-B673-A1FFD17D97EE` | en-US / US (miles) | Hawaii (us-hawaii), 10 guides, English Wikipedia all-mini, Apple Intelligence | Honolulu 21.3069,-157.8583 |

App data: `xcrun simctl get_app_container <udid> com.fjlinde.nomadpocket data` → `Documents/content/index/search.db`
(map search index, `map_pois`, document passages) and `Library/Application Support/SQLite/nomad.db`.
Typing accents with `axe type` fails: paste with `xcrun simctl pbcopy <udid>` + Cmd+V. If the simulated
location stops arriving (CoreLocation "request timeout"), `xcrun simctl location <udid> clear` then `set`.

---

## Major

### R1 — Assistant ignores Spanish questions' own words when Apple's router answers in English
- **Repro** (`NP-review`, Spanish, Apple Intelligence, library on): ask "¿Dónde quedamos si no nos
  localizamos?", "¿Cuál es nuestro punto de encuentro?" or "Si no hay cobertura, ¿dónde nos reunimos la
  familia?" → "No lo he encontrado en tu biblioteca" with unrelated sources. In English ("Where do we meet
  if phones are down?") the plan's meeting point is found.
- **Cause (confirmed with temporary logs)**: the router returns `{"search":true,"query":"meeting point"}`.
  `retrieve()` (`src/features/assistant/rag.ts`) drops a model query in another language only when
  `detectLanguage(modelQuery, lang) !== lang`, but `detectLanguage` (`rag-core.ts`) returns the fallback
  for short queries: `detectLanguage('meeting point','es')`, `'bee sting treatment'`, `'snake bite'`,
  `'family meeting point'` → `'es'`. So `rankText = "meeting point"`; top chunks were the Wikipedia article
  "Point" and PDF pages; the Spanish plan passage never matches. Ranking with the question itself puts the
  meeting passage first (checked offline with `planPassages` + `rankChunks`).
- **Fixed when**: a short model query in another language than the question is not used for ranking (e.g.
  require positive evidence that the query is in the question's language, or always rank against the
  question's words plus the query's), with unit tests in `rag-core.test.ts`; the three Spanish phrasings
  above retrieve the plan's meeting passage. English questions must keep working (the build-23 fix where
  the router wrote Spanish queries for English questions).

### R2 — The nearest hospital can't be found in a dense city
- **Repro** (`NP-review`, Madrid centre): SOS → "Salud" lists 40 items, all pharmacies, AEDs and health
  centres within 590 m; no hospital. Map search "hospital" → localities named "Hospital"/"El Hospital"
  29–76 km away; "farmacia" → only POIs named exactly "Farmacia", 1.9–5.9 km, though dozens are within
  300 m; "farmacia sol" → "Farmacia del Sol" 445 km first. In Honolulu SOS does show The Queen's Medical
  Center (sparser data).
- **Cause**: `src/app/(tabs)/maps/emergency.tsx:90` `nearestEmergencyPlaces(category, here, 40)` mixes all
  health kinds by distance. Map search (`places.ts` `searchPlaces`, `places-core.ts` `rankHits`) matches
  names only, never the kind.
- **Fixed when**: the Health list always shows the nearest hospitals (e.g. a "Hospitales" group or the
  nearest N hospitals first, with an emergency room flag when known) even when 40 pharmacies are closer;
  searching a category word ("hospital", "hospitales", "farmacia", "pharmacy", "police", "policía",
  "agua potable"…, es + en) returns the nearest places of that kind, sorted by distance, before name matches
  far away. Unit tests for the pure parts.

### R3 — Wrong health content in answers
- **Repro**: "Mi hijo se ha quemado la mano con aceite hirviendo, ¿qué hago?" → sources included
  "Dermatitis de contacto por urushiol" (matched on "aceite") and the answer said "El aceite contiene
  urushiol…". English "How do I treat a snake bite?" → "Apply a tourniquet near the fang marks"
  (from Hospital Corpsman); current first-aid guidance says no tourniquet.
- **Cause**: `relevantChunks` lets a chunk through with 2 shared terms of 3–5; a model query with
  "aceite" pulled the urushiol article. The snake-bite advice comes from an old manual in the library.
- **Fixed when**: chunks that only share generic words with the question don't reach the prompt (e.g. weight
  terms by IDF in `relevantChunks`, or require the strongest term); the health caution rule tells the model
  not to mix in conditions the question isn't about and to prefer current first-aid guidance (no
  tourniquet / cutting / suction for snake bites, cool running water ~20 min for burns). Tests.

### R4 — Apple guardrail error shown in raw English, no retry
- **Repro**: the burn question above, asked again: banner "El modelo no ha podido responder: The model's
  safety guardrails were triggered." (Spanish UI). Same question answered fine 10 minutes earlier.
- **Cause**: on iOS 27 the error reaching `NomadLlmModule.swift` `describe()` during streaming is not
  `LanguageModelSession.GenerationError.guardrailViolation` (the message is FoundationModels' own
  "The model's safety guardrails were triggered."), so it maps to `ERR_GENERATE` with
  `localizedDescription`, and `src/features/assistant/errors.ts` shows the raw text.
- **Fixed when**: guardrail errors map to the translated `declined` key however they arrive (match the
  error by type where possible, and in JS also recognise the known English messages as a fallback); the
  banner offers a retry. Unit test in `errors.test.ts`.

### R5 — "Not found" answers still list every source
- **Repro**: the meeting-point questions in R1 → "No lo he encontrado…" followed by 10+ sources ("The
  Jungle Book", "Anexo:Puntos de acupuntura", "Hospital Corpsman"…).
- **Cause**: `chats.ts` keeps only cited sources, *all* of them when none is cited.
- **Fixed when**: an answer that cites nothing shows no sources when it says it found nothing (or at most
  the top 3), and PDF sources show a readable title, not the file name ("173165 · pág. 29",
  "dead falls snares b00harduoft · pág. 223"): use the PDF's own title/metadata or the ZIM entry title.

### R6 — Search and place card ignore localized names; apostrophes
- **Repro** (`NP-review`, Israel and Georgia installed): the map draws Spanish names ("Muro de las
  Lamentaciones", "Tiflis"), but search rows and the place card show only the native name: "Jaffa Gate" →
  "שער יפו · Lugar · Հայկական Թաղամաս" (neighbourhood in Armenian). "Puerta de Jaffa", "Tiflis",
  "Jaffa Road 100" → nothing; "Tbilisi" and "Tel Aviv" → hotels, not the city; the city only matches as
  "თბილისი". In Honolulu "mcdonalds" and "queens medical center" → nothing (they match with the
  apostrophe: "McDonald's", "queen's").
- **Cause**: rows keep one display `name` plus a bag of other names (`places-core.ts` `NAME_KEYS`,
  `scripts/routing/places.py` `OTHER_NAMES`); localities may come from the tiles; FTS splits "Queen's" into
  `queen` + `s`.
- **Fixed when**: a name typed without its apostrophe matches (normalize apostrophes away in both the
  indexed text and the query); cities match their English and Spanish names; rows and the place card show
  the name in the app language when the data has one (native name as the subtitle). If showing localized
  names needs a new side-file column, change the app side so it works with the data it has, and document
  what the CI scripts would need (don't change the published data format in this pass).

## Minor

- **R7** Map saturated with health dots at city zoom (Madrid; `emergency.ts` `emergencyPlacesIn` limit 600):
  thin them by zoom (e.g. only hospitals and a sample below a zoom, or cluster) so streets stay readable.
- **R8** Country picker search: "EEUU", "USA", "UK", "Inglaterra"… find nothing (`regions.ts`
  `groupCountries`). Add common aliases and ISO3 codes.
- **R9** Home "Tu preparación" counts the guides as ready after the first of 12 is installed while the row
  still shows "Descargando… 9 %" (`features/home/readiness.ts`: `done: guidesHave > 0`). Not done while a
  guide download is in flight.
- **R10** Plan form sheets (meeting point, new contact, new person) open scrolled: the first lines
  (subtitle, "LUGAR"/"NOMBRE") sit under the sheet header until dragged down.
- **R11** After switching the app language in Settings, "Used by Nomad" keeps the old locale ("19,8 GB" among
  "4.6 GB") until reopened; Home's "Using 19.2 GB" and Settings' "19.8 GB" disagree at the same moment.
- **R12** Onboarding region auto-pick (`countries.ts` `useChosenRegions`): a location timeout picks `[]` and
  never retries, so the user's region (Hawaii, located in Honolulu) stays unticked with no hint. Retry
  when a fix arrives later while the screen is open.
- **R13** Reader dark mode (CSS invert) on an archive that is already dark (freeCodeCamp): the navy header
  becomes light grey with white text. Skip the invert for archives whose page background is already dark.
- **R14** Duplicate address rows from diacritic variants ("Kalākaua Avenue, 2005" and "Kalakaua Avenue,
  2005", same place): deduplicate rows with the same normalized name, number and nearby position.
- **R15** Model quality notes (no code fix expected unless cheap): "agua fría o tibia, no fría"; a follow-up
  health answer without the "Información de referencia" line; English "purify water without fire" leading
  with a Uruguayan army device.

## Known / out of scope

- Emergency number only 112/911 (`emergency.ts` `NINE_ONE_ONE`; Israel shows 112): already in the backlog.
- Kiwix Explore search "medicina" → no results: the OPDS server returns none either.

## Checked and fine

Onboarding and kit downloads (Spain 19.5 GB in ~10 min; US/Hawaii regions), family plan and emergency kit
(litres in Spain, gallons in the US), reader (find in page, bookmarks, text size, dark mode), library search,
courses and progress, Explore, street/house number/coordinate search, car/foot/bike routes with steps and
rerouting, SOS lists, miles/feet and "Call 911" in the US, Hebrew/Arabic/Georgian labels, adding and removing
countries (files and index removed), saved places, English assistant answers from the family plan.

## Fix status

Fixed 2026-10-28 by a Sonnet workflow (one agent per area, isolated worktrees), reviewed and integrated by
the lead, re-tested on both simulators with a Release build.

| Item | Status | Verified on the simulator |
|---|---|---|
| R1 | fixed: `planRetrieval` / `languageEvidence` (rag-core) | the three Spanish phrasings cite "Plan familiar · Puntos de encuentro" |
| R2 | fixed: SOS leads with the 3 nearest hospitals (police/fire in Security); category words search the nearest of that kind | SOS Madrid: 3 hospitals then the 30 m AED; "hospital"/"farmacia"/"policía" in Madrid and Honolulu give the nearest |
| R3 | fixed: stricter `relevantChunks` (half of 3–8 terms; one more when an article's title shares no root with 4+ terms) + health caution rule (no tourniquet, 20 min cool water, only the condition asked) | burn answer: 20 min cool water, sources only "Quemadura térmica"; the router query "quemadura aceite hirviendo tratamiento" no longer lets the urushiol article in (unit test). Old manuals stay in the library; the caution rule overrides them |
| R4 | fixed: Swift `describe()` and `errors.ts` map guardrail text to `declined`; banner "Reintentar" (`retryLast`) | Swift compiles; the guardrail itself couldn't be triggered on demand |
| R5 | fixed: `sourcesToShow` (none for "not found", else top 3 when nothing cited), `readableDocTitle` | "teléfono de mi dentista": one cited source instead of ten |
| R6 | fixed: apostrophes, cities by English/Spanish name, localized name + native subtitle for tile rows (`INDEX_VERSION` 2); pack side files get trailing name:es / name:en columns (places.py, streets.py; old apps ignore them) and the import builds the same slots | "mcdonalds", "queens medical center", "Tel Aviv", "Honolulu" on the sims. Pack rows: real Jerusalem files run through the import ("Jaffa Gate" shows as Jaffa Gate; "Garden Tomb" / "Tumba del jardín" in the app language); on phones once the monthly CI rebuilds the packs (next 2026-11-05). "Puerta de Jaffa" has no name:es in OSM, and the street is "Jaffa" in English, not "Jaffa Road": data, not code |
| R7 | fixed: `thinForZoom` below z17 | Madrid at ~z15 readable (fx-map8 vs map2) |
| R8 | fixed: `region-terms.ts` (ISO3 + common names) | EEUU, USA, UK, Holanda |
| R9 | fixed: guides not ready while one downloads | code review only |
| R10 | fixed: no `automaticallyAdjustKeyboardInsets` in the plan form sheets (the agent's delayed-focus attempt made it worse and was dropped) | contact and meeting sheets open with the first label visible |
| R11 | fixed: Home adds the search index like Settings; `formatBytes` takes the language read in render | 20.2 GB in both, new locale at once |
| R12 | fixed: a timed-out fix is followed by one `watchPositionAsync` while the screen is open | not exercised (needs a timeout) |
| R13 | fixed: dark mode no longer re-inverts SVG images (iOS + Android CSS): freeCodeCamp's white header logo was re-inverted while its navy bar turned light | freeCodeCamp header readable in dark mode |
| R14 | fixed: `dedupeHits` by `rankKey` + distance | "2005 Kalakaua Ave": one row |

Side effect to know: the `INDEX_VERSION` bump re-indexes every installed map's tiles once after the update
("Preparando búsqueda y puntos…", ~5 min for Spain on the simulator; the map row isn't "ready" meanwhile).
Lead's corrections to the agents' work: `dedupeHits` was O(n²) with regex keys and slowed common searches to
5–9 s (now ~1.6 s); 3 priority places instead of 6; years kept in PDF titles; no retry button for errors a
retry can't fix; empty `nativeName` for unnamed category hits.
