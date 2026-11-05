# Assistant × maps: ask the assistant about places, routes and where you are — plan

Owner request (2026-11-05): let the assistant answer map questions ("búscame una farmacia cerca de Móstoles",
"cómo voy de X a Y") and trigger the app's own map features (navigation, calls, sharing the position).
Analysed the same day against the code as of 8b59e9d. Owner's decisions, same day:

- **Every use case below goes in the plan** (the owner asked for all of them, in three phases).
- **No health gate on Android for map questions.** Hospitals, pharmacies, clinics, defibrillators… found on the
  map are general utility (`docs/ANDROID_PLAY.md` already says so for the map). The assistant's
  `isHealthQuestion()` pre-check runs first today: the map intent must be tested **before** it, so "farmacia cerca
  de Móstoles" never gets the fixed "no health" answer on Android. A health *question* that mentions a place
  ("¿cómo curo una quemadura en Móstoles?") is still a health question: only a recognised map intent skips the gate.
- **Answers come from the data, not from the model.** The model may help understand the question; it never writes
  a name, an address, a phone, a distance or a time. The answer is a card built from the index (same reason the
  vital cards are quoted word for word: the 4B model's paraphrases were dangerous).

Approved to implement. **Phase 1 built 2026-11-05, except task 8 (1b, the model fallback) and the measuring**: see
"Phase 1 — status" below.

## The idea in one paragraph

Everything a map question needs is already on the device and already queryable with SQL: the place index
(`map_places`, FTS5), the emergency points (`map_pois`, with phone and opening hours), house numbers, routing packs
(Valhalla), saved markers, the family plan's meeting points, the active official alerts with their polygons, and
the per-country emergency numbers. None of it is vectorised, and none of it needs to be: "nearest pharmacy to a
town" is a geocode plus a distance-ordered query, which is exact, instant and offline. So the feature is a
**map intent layer** in the assistant: recognise the question, resolve the places in it, run the query, and
answer with a **map card** in the chat whose buttons open what the app already has (place card, route preview,
navigation, call, share).

## What there is today (code as of 8b59e9d)

| Piece | Where | Use here |
|---|---|---|
| Place search (names, POIs, streets, doors) | `features/maps/places.ts` `searchPlaces(text, near)` | Resolve "Móstoles", "Calle Mayor 12", a POI by name |
| Category words → kinds | `places-core.ts` `categoryKinds()` (+ `CATEGORY_WORDS`, es + en, tested) | "farmacia(s) cerca" → `['pharmacy']`. Today only when the **whole** text is a category |
| Emergency points | `emergency.ts` `nearestEmergencyPlaces(category, from)`, `emergencyPlacesIn(bbox)`, `getEmergencyPlace` | Nearest by distance; the SQL already filters by kind inside, needs a public by-kind entry |
| 17 emergency kinds, 5 categories | `emergency-core.ts` `EMERGENCY_KINDS` | What "near X" can find with phone/hours. Other POI kinds only by name (`map_places`, layer `poi`) |
| Locality / address of a point | `places.ts` `addressNear(p, street)`, `localityNear` | "Calle X 14 · Móstoles" lines, "dónde estoy" |
| Routing | `routing.ts` `computeRoute(from, to, costing)`, `canRoute`, `packFor`; `routing-core.ts` `COSTINGS` (auto, pedestrian, bicycle), `avoid` → Valhalla `exclude_polygons` | Times and distances, "llévame", avoiding an alert area |
| Navigation | `guidance.ts` `startGuidance(target)` | Always from the GPS position to a target (no other origin today) |
| Map UI | `store.ts` `showPlace(p)`, `useMapUi.focus` | "Ver en el mapa" |
| Calls | `call.ts` `callPhones(raw)`, `emergency.ts` `emergencyNumber()` | "Llamar", the right 112/911 for the country you're in |
| Share position | `app/(tabs)/maps/emergency.tsx` `share()` + `maps:emergency.shareMessage` (coords, UTM, accuracy, time, OSM link) | "Manda mi ubicación" (move the text builder to a shared function) |
| Coordinates | `geo.ts` `parseCoordinates`, `formatLatLon`, `toUtm`/`fromUtm`/`formatUtm`, `bearingDegrees`, `compassSector`, `metersToLine`, `bboxAround` | UTM, "llévame a 40.32,-3.86", "al suroeste", corridor searches |
| Saved places | `map_markers` (name, lat, lon, color, note) | "el coche", "casa" |
| Family plan | `features/prepare` `MeetingPoint { place, details, markerId }` (primary, secondary), `Contact { name, relation, phone }` | "¿dónde quedamos?", "manda mi ubicación a mamá" |
| Official alerts | `features/alerts` `Alert.polygons`, `inPolygons`, quake distance rule, `useAlertsState` | "¿hay avisos aquí?", "¿afecta a mi ruta?" |
| Country of a point | `country-at-core.ts` + `country-shapes.json` | Embassies, the right emergency number, trip prep |
| Compass / location | `src/lib/location.ts` (iOS expo-location, Android `modules/nomad-location`) | "cerca de mí", live arrow on the card |
| Voice | assistant dictation; maps `voice.ts` (guidance TTS) | Hands-free questions and spoken answers |
| Assistant decision | `chats.ts` `answer()`: health gate → vital card → engine (`tools` for GGUF, `router` for Apple FM) | Where the map path plugs in |
| Messages | `chat_messages.sources` JSON | Needs a place for the map card's data (below) |

Not there: an opening-hours parser (`PlaceCard` shows the raw OSM string), any sun/twilight maths, a route preview
from an origin other than the GPS position, a "nearest road" query, embassy country tags.

## Architecture

### 1. The map intent core (pure, tested)

`src/features/assistant/map-intent-core.ts` (pure: no `@/`, `.ts` sibling imports, `*.test.ts` next to it; add
it to the CLAUDE.md list of pure modules). `parseMapIntent(text, history, lang)` returns `null` or one of:

```ts
type MapIntent =
  | { kind: 'nearby'; kinds: string[]; near: PlaceRef; openNow?: boolean; name?: string }  // farmacia cerca de Móstoles
  | { kind: 'goNearest'; kinds: string[]; costing?: Costing }                              // llévame al hospital más cercano
  | { kind: 'route'; from: PlaceRef; to: PlaceRef; costing?: Costing; askOnly?: boolean } // cómo voy de A a B / cuánto tardo
  | { kind: 'whereAmI'; forCall?: boolean; utm?: boolean }                                  // dónde estoy / qué le digo al 112
  | { kind: 'shareLocation'; to?: string }                                                  // manda mi ubicación (a mamá)
  | { kind: 'callNearest'; kinds: string[] }                                                // llama a la comisaría más cercana
  | { kind: 'saveHere'; name: string } | { kind: 'goSaved'; name: string }                  // guarda esto como "el coche" / llévame al coche
  | { kind: 'meetingPoint' }                                                                // dónde quedamos si nos separamos
  | { kind: 'lost' }                                                                        // estoy perdido
  | { kind: 'beforeDark'; to: PlaceRef; costing?: Costing }                                 // ¿llego antes de que anochezca?
  | { kind: 'coords'; to?: LatLon; format?: 'utm' | 'dms' }                                 // mis coordenadas en UTM / llévame a 40.3,-3.8
  | { kind: 'alertsHere' } | { kind: 'alertsOnRoute' } | { kind: 'evacuate' }
  | { kind: 'alongRoute'; kinds: string[]; to?: PlaceRef }                                  // gasolineras de camino a Valencia
  | { kind: 'aboutPlace'; place: PlaceRef }                                                 // háblame de Móstoles
  | { kind: 'trip'; country: string };                                                      // me voy a Marruecos

type PlaceRef = { here: true } | { text: string } | { saved: string } | { coords: LatLon } | { previous: number };
```

Rules: Spanish and English patterns (`cerca de|en|por|junto a|near|in|around`, `de X a Y`, `from X to Y`,
`llévame|take me|cómo (voy|llego)|how do I get`, `andando|a pie|en coche|en bici|walking|driving|cycling` →
costing). Category words come from `CATEGORY_WORDS`, opened up so they match **inside** a sentence ("¿hay alguna
farmacia abierta por aquí?"), plural and singular, accents off (`normalizeName`). Add synonyms that mean a kind
("comprar ibuprofeno" → pharmacy, "repostar" → fuel, "agua para beber" → drinking_water, "dormir" → shelter).
`previous` resolves "la segunda", "esa", "¿y cómo llego?" against the last map card in the conversation.
Anything ambiguous returns `null` and the question goes the normal way: a false positive (a library question
answered with a map card) is worse than a miss.

### 2. Resolving places

`resolvePlace(ref, here)` in a new `features/assistant/map-answer.ts` (app side, uses the maps exports):
- `here` → the last fresh fix (`isFreshFix`), else ask for it; denied → the card says so with "Ajustes".
- `text` → `searchPlaces(text, here ?? viewport centre)`, preferring layer `place` (towns, neighbourhoods) for a
  bare name and doors/streets for an address. **Ambiguity**: two candidates of similar importance more than ~20 km
  apart ("San Sebastián", "Villanueva") → the card asks "¿Cuál?" with chips (name · province), never guesses.
- `saved` → `map_markers` by name (normalised, fuzzy), then the plan's meeting points.
- Nothing found → "No encuentro X en los mapas instalados" + "Descargar mapas" when the country is known.

### 3. The map card in the chat

- **Storage**: a new user migration appending `ALTER TABLE chat_messages ADD COLUMN map TEXT` (JSON: intent kind,
  resolved places, result rows with osmId/name/kind/lat/lon/distance/phone/hours, route summary). Old messages keep
  `NULL`. The text column holds a plain-text rendering (for history trimming, copy and follow-ups).
- **UI**: `features/assistant/ui/MapAnswerCard.tsx` from `components/ui` (`ListRow` with `trailingAction`, never a
  pressable in a pressable): up to 5 rows (kind icon from `maps/labels.ts`, name, "Calle X 14 · Móstoles",
  distance + direction, badges: abierto ahora / urgencias / 24 h), and actions per row: **Ver en el mapa**
  (`showPlace` + switch to the Maps tab), **Cómo llegar** (`startGuidance`), **Llamar** (`callPhones`). A footer
  line with the data's age ("Puntos de OpenStreetMap, actualizados el 2 nov") and, for pharmacies, "OpenStreetMap no
  sabe qué farmacias están de guardia".
- **Never acts alone.** Calling, sharing, saving and starting navigation are always a tap on the card. "Llévame"
  opens the route preview (`start`), "Iniciar" stays the person's tap.
- i18n: a new `assistant` keys block (es + en); testIDs listed in `docs/E2E.md`.

### 4. Where it plugs into `chats.ts`

At the top of `answer()`, **before** `noHealth` and `vitalCard`: `const intent = parseMapIntent(text, history,
lang)`. A map intent answers with its card and returns (no model needed, works with "Usar mi biblioteca" off and
with no model installed). Phase 1b adds the model's say for phrasings the parser misses (below).

### 5. Model fallback (phase 1b)

- **GGUF (tools)**: a second tool `search_map({ category, near, to, mode })` next to `search_library`
  (`rag-core.ts` spec, `engine.ts` already loops over tool calls). Its result is the card's data; the model's text
  around it is dropped: the card is the answer.
- **Apple FM (router)**: extend `SearchDecision` (`modules/nomad-llm/ios/NomadLlmModule.swift`) with
  `map: Bool`, `mapCategory: String`, `mapPlace: String` (guided generation, few-shot from JS). Cheaper than the
  `Tool` protocol and the same one-shot shape as today.
- The category the model gives must map to a known kind (`CATEGORY_WORDS`), the place goes through
  `resolvePlace`. Unknown → normal library answer.

## Use cases

Each: example phrases · data · what's new · edge cases. **(P1/P2/P3)** = phase.

### Points near a place

1. **Nearest X near a place (P1).** "Búscame una farmacia cerca de Móstoles", "hospitales en Getafe", "¿hay
   gasolineras por aquí?". `map_pois` by kind ordered by distance from the resolved place; then `map_places` POIs
   of the same kind from the tiles (fallback when the points weren't fetched). New: `nearestOfKinds(kinds, from)`
   exported from `emergency.ts`; in-sentence category matching. Edge: no points for that area → say so + "Descargar
   puntos" (online) and fall back to tile POIs; "cerca" means sorted by distance, capped at ~25 km (beyond, say how
   far the nearest is).
2. **Several needs at once (P1).** "Necesito agua y un sitio donde dormir". Several kinds → one card with a
   section per kind (2–3 rows each) and "Ver todos en el mapa" (fit the camera to them).
3. **Defibrillator, walking (P1).** "¿Dónde está el desfibrilador más cercano?". Kind `defibrillator`, pedestrian
   times for the first 3 (route 3), the closest leading. Footer: indoor AEDs may be locked outside opening hours.
4. **Embassy of a country (P1).** "¿Dónde está la embajada de España?". Kind `embassy` filtered by name/operator
   (es/en/native: "Embajada de España", "Embassy of Spain", "Ambassade d'Espagne"). Better: add OSM `country` (ISO
   code on diplomatic nodes) to `OVERPASS_TAGS` and a `country` column to `map_pois` (an `INDEX_MIGRATIONS` entry;
   points refetched on the next sync). Edge: consulates vs embassies (show both, labelled).
5. **Open now (P2).** "¿Qué supermercado está abierto ahora?", "farmacia abierta". New pure
   `features/maps/hours-core.ts`: a subset parser of OSM `opening_hours` (`24/7`, `Mo-Fr 09:00-14:00,17:00-20:00`,
   `Sa`, `Su off`, `PH off`, several rules `;`), returning open / closed / unknown at a given local time. **Unknown
   is never "open"**: those rows go after, badged "horario desconocido". Licence note: `opening_hours.js` is
   LGPL-3.0 (compatible) but large; our subset covers the common forms, measure on Spain's points first (share of
   strings the subset parses). The place card gets the same "Abierto ahora" badge.

### Going somewhere

6. **Take me to the nearest X (P1).** "Llévame al hospital más cercano", "a la gasolinera más cercana". Take the 5
   nearest by straight line, route each with `computeRoute` (pedestrian/auto from the phrase, else the guidance
   store's costing), order **by time**: across a motorway or a river the closest point is often not the quickest.
   The card shows the winner with its time and the runners-up; "Cómo llegar" opens the preview. Hospitals: those
   with `emergency=yes` first among similar times. Edge: no routing pack → straight line order, say so (the
   guidance already falls back to a straight line). Measure 5 routes' latency on a phone; cap by time budget.
7. **From A to B (P1).** "¿Cómo voy de Móstoles a Alcorcón?", "llévame a la Calle Mayor 12", "ruta a pie a…". Origin
   defaults to here. **From here** → preview + navigation as today. **From elsewhere** → the card gives distance and
   time and draws the route on the map as a preview; navigation only starts from the GPS position (new: a
   `previewRoute(from, to, costing)` in `guidance.ts` that draws without following). Edge: A or B ambiguous (chips);
   no pack covers both ends (`packsFor`) → straight-line distance + "Descargar rutas de X".
8. **How long to X (P1).** "¿Cuánto tardo andando a Arroyomolinos?". `route` with `askOnly`: one line ("1 h 25 min a
   pie, 6,8 km") + "Ver ruta". Same routing as 7.
9. **Coordinates as a destination (P2).** "Llévame a 40.3218, -3.8650", "a 30T 430500 4466200", "40°19'N 3°52'W".
   `parseCoordinates` already reads decimal and DMS; add UTM input (`fromUtm`). Card: the point, what's there
   (`addressNear`), "Cómo llegar".
10. **Saved places (P2).** "Guarda dónde estoy como 'el coche'" → a `map_markers` row (the card confirms with
    "Guardar"; never silently). "Llévame al coche", "¿dónde aparqué?", "llévame a casa" → marker by name (fuzzy:
    "coche" matches "el coche", "Mi coche"). Edge: no marker of that name → list the markers as chips.
11. **Family meeting point (P2).** "¿Dónde quedamos si nos separamos?", "llévame al punto de encuentro". The plan's
    `meeting.primary` / `secondary` (`features/prepare`), with its marker when it has one; without a marker, the
    text the family wrote + "Añadir en el mapa". Route to the primary, the secondary as an alternative.

### Where am I

12. **Where am I / what to tell 112 (P1).** "¿Dónde estoy?", "¿qué le digo al 112?", "dime mi dirección". The card
    reads in the order an operator asks: street and number (`addressNear`), town, a landmark ("a 200 m de la
    gasolinera Repsol": nearest named POI), coordinates, UTM, GPS accuracy, time of the fix; a **Llamar al 112**
    button with the number of the country you're in (`emergencyNumber()`). Honest note: on a call, phones in the
    EU and the US already send their position to the emergency centre (AML / E911); this is for when they ask, or
    the call is by someone else. Edge: fix older than ~2 min or worse than ~100 m → say it, show its age.
13. **Share my location (P1).** "Manda mi ubicación por SMS", "comparte dónde estoy", "manda mi ubicación a mamá".
    The Emergencias share text moved to a shared builder (`maps/share-location.ts`), used by both. Buttons:
    **SMS** (`sms:` URL with the body: SMS often gets through with weak coverage and no data; body syntax differs
    iOS `sms:&body=` / Android `sms:?body=`), **Compartir** (share sheet). "A mamá" → the plan's contacts by name
    or relation → SMS to that number prefilled. Always the person's tap to send.
14. **Coordinates in UTM / DMS (P2).** "Pásame mis coordenadas a UTM", "¿en qué cuadrícula estoy?". Rescue in
    Spain (GREIM, bomberos forestales) works in UTM; `toUtm` + `formatUtm` exist. Also "¿qué coordenadas tiene
    Móstoles?".
15. **Lost (P2).** "Estoy perdido", "¿hacia dónde está el pueblo más cercano?". Card: nearest locality with
    distance and direction ("Navalcarnero, 7 km al suroeste", `bearingDegrees` + `compassSector`) and a **live
    arrow** (compass heading from `src/lib/location.ts`); nearest road; nearest water and shelter; sunset time
    (#16); "Cómo llegar" on foot; "Compartir ubicación". New: nearest road. Options to measure: Valhalla's
    `locate` on the routing pack (if the wrapper exposes it), or the roads in the z14 tile under the point
    (`features/maps` already decodes MVT); `map_places` stores roads without a spatial index (FTS5, lat/lon
    unindexed), so not that.
16. **Before dark (P2).** "¿Llego andando a X antes de que anochezca?", "¿cuánta luz me queda?". New pure
    `features/maps/sun-core.ts`: sunrise, sunset and civil dusk for a point and a date (NOAA algorithm; tests
    against published tables for Madrid, Reykjavík in winter and summer, polar day/night). Answer: arrival time
    (pedestrian route) vs sunset and civil dusk: "Llegarías a las 19:40; anochece a las 18:52 (luz útil hasta las
    19:20)". Time zone: the device's (the person is there).

### Alerts and the map

17. **Alerts near me (P2).** "¿Hay alertas cerca?", "¿ha habido terremotos por aquí?", "¿qué avisos hay en
    Valencia?". `features/alerts` state: active warnings whose polygon covers the place (`inPolygons`) or zone
    matches, quakes by the existing distance rule; each row opens the alert screen. Works only when alerts are on
    and were checked: say when they were last checked ("Comprobado hace 2 h"); offline and stale → say it.
18. **Does the warning affect my route? (P3).** "¿El aviso rojo afecta a mi ruta?". Route shape vs the active
    polygons (any shape point inside, or a segment crossing an edge). Only for alerts with drawn areas (AEMET, NWS,
    GDACS); MeteoAlarm has zone codes only (no polygons, `docs/ALERTS_PLAN.md`): say "afecta a la zona X", no
    route verdict. Offer "Ruta evitando la zona" (`avoid` → `exclude_polygons`, already in `routeRequest`).
19. **Get out of the warning area (P3).** "Tengo que salir de la zona del aviso", "¿adónde voy?". Nearest shelter,
    assembly point or town **outside** every active polygon that covers you, routed with those polygons excluded
    where possible (you are inside one: Valhalla needs the origin outside `exclude_polygons`, so exclude only the
    others, or route to the area's edge first; to verify on valhalla 3.9.1). Heavy disclaimer: follow the
    official instructions (the alert's `instruction` text shown first).

### Along the way

20. **Along the route (P3).** "Gasolineras de camino a Valencia", "agua en la ruta", "¿me da la gasolina? tengo 80 km
    de autonomía". Points within ~2 km (auto) / ~300 m (walking) of the route: bbox of the shape → `map_pois` →
    `metersToLine`. Ordered by distance along the route, with "a 34 km" from the start. Autonomy: flag the stretch
    beyond the range and the last fuel before it. Uses the active route or computes one to the place named.

### Knowledge and the map

21. **About a place (P3).** "Háblame de Móstoles", "¿qué es esto que tengo cerca?". The map card (where it is) +
    the library answer about it (Wikipedia offline through `library/zim.ts` title lookup, same retrieval as
    today). "Esto que tengo cerca" → the nearest named POI or place to the GPS position.
22. **Places in library answers (P3).** When a normal library answer names a town or landmark that the index knows,
    a "Ver en el mapa" chip under the answer. Only `place` layer hits with high importance and an exact name match,
    capped at 3, to keep noise out (measure false positives on the bench's 50 answers).

### Preparing a trip

23. **Trip prep (P3).** "Me voy de viaje a Marruecos, ¿qué necesito?". Country from the name (`countries.ts`,
    es/en names). Card: what's installed and what's missing for it (map, routing pack, emergency points, an archive
    in its language if any), its emergency numbers (`emergency-numbers.json`), the embassy of the person's country
    there (when the map is in, #4), active alerts there. Buttons open the existing download screens (downloads only
    online, as today). The assistant itself stays offline.

### Hands-free

24. **Voice (P2 dictation + spoken answer; P3 car).** Dictation already feeds the assistant: map intents work with
    it as is. Add a spoken summary of a map card ("La farmacia más cercana está a 600 metros, en la calle Mayor")
    with the maps TTS (`maps/voice.ts`), on when the question was dictated. Car (P3): CarPlay already has
    Emergencias and search screens (`features/carplay`, and the Android Auto spike); evaluate a voice "Buscar"
    there using the same intent parser (CarPlay's search template takes dictated text). Never read a list of 5
    while driving: the first result and "Ir".

## Phases and tasks

### Phase 1 — the core and the urgent cases (1, 2, 3, 4, 6, 7, 8, 12, 13)

1. `map-intent-core.ts` + tests: patterns es/en, in-sentence categories, synonyms, costing, `previous` refs; a test
   table of ~150 phrases (positives per intent and **negatives**: library questions that mention places or
   categories, e.g. "historia de los hospitales de campaña", "¿qué es una farmacia de guardia?").
2. `map-answer.ts`: `resolvePlace`, by-kind nearest (`emergency.ts` export), ambiguity chips, coverage messages.
3. `chat_messages.map` migration, `MapAnswerCard`, the actions, i18n es/en, testIDs.
4. Hook in `chats.ts` before the health gate; follow-ups ("la segunda", "¿cómo llego?").
5. Nearest by time (6): route the 5 nearest; latency measured on an iPhone and a mid Android.
6. A→B (7, 8) with `previewRoute` for an origin other than here.
7. Where am I / 112 (12), shared location builder and SMS (13), embassy `country` tag (4).
8. **1b**: `search_map` tool (GGUF) and the router fields (Apple FM), measured on the bench (below).
9. E2E flows (iOS and Android): "farmacia cerca de <fixture town>" → card → Ver en el mapa; "llévame al hospital
   más cercano" → preview; "¿dónde estoy?" with a simulated location. Fixture index with known points.

### Phase 1 — status (2026-11-05)

Built and verified (unit tests; E2E `ai-10-map-answers` on the iOS 27 simulator with Andorra seeded; `ai-01`,
`ai-03`, `map-10`, `map-12` still pass):

- Tasks 1–4: `map-intent-core.ts` + ~130 phrases (positives, negatives, follow-ups); `map-answer.ts`; the
  `chat_messages.map` migration (v5); `MapAnswerCard`; the hook in `chats.ts` before the health gate; follow-ups
  ("¿y en Getafe?", "llévame a la segunda"); the "which one?" card answered in place.
- Task 5: nearest by travel time (5 candidates routed in turn, 6 s budget; an ER hospital leads among similar times).
- Task 6: A→B and "¿cuánto tardo…?"; from elsewhere the card gives time and distance and "Ver en el mapa" frames
  both ends (no route drawn: `previewRoute` is still to do); navigation starts from where you are.
- Task 7: where am I / what to tell 112 (locality, landmark, coordinates, UTM, the country's number, the AML
  note), share and SMS (`maps/share-location.ts`, now also used by Emergencias), plan contacts by name or relation.
  Embassies: filtered by the country's name in a few languages (`COUNTRY_ALIASES`); the OSM `country` tag on
  Overpass is not added yet.
- Extra: saved markers ("casa", "el coche") and the plan's meeting point resolve by name (part of #10, #11); an
  answer waits up to 20 s for maps still being indexed or imported, then says so ("preparing") instead of "not found".

Left in phase 1: task 8 (1b: `search_map` tool and router fields, measured on a `gold-map.json` bench); the
Android emulator check; latency of nearest-by-time on a real phone; `previewRoute` from another origin; the
embassy `country` tag.

### Phase 2 — everyday and outdoors (5, 9, 10, 11, 14, 15, 16, 17, 24 voice)

`hours-core.ts` (+ the place card badge), UTM input, markers save/go, meeting points, UTM output, lost card with
live arrow and nearest road, `sun-core.ts`, alerts near, spoken summary.

### Phase 3 — crossing features (18, 19, 20, 21, 22, 23, 24 car)

Route vs alert polygons and avoid, evacuation, along-route search, place ↔ library, trip prep, car voice search.

## Measuring

- **Unit**: the intent table (precision first: zero false positives on the negatives), `hours-core`, `sun-core`,
  route/polygon intersection, corridor filter.
- **Bench**: `scripts/assistant-bench/gold-map.json`, ~60 map questions (Spanish, a few English) with the expected
  intent and place, plus the 50 crisis questions re-run to prove none of them is now taken by the map path. Run
  the parser alone (fast), then 1b with Qwen3.5 4B and Apple FM for the phrasings the parser misses.
- **On device**: latency of nearest-by-time (5 routes) and of a corridor search on a long route; the card at
  VoiceOver / TalkBack.

## Risks and limits to say out loud

- Only 17 kinds carry phone/hours (`map_pois`); other POIs ("una panadería", "un restaurante") are found only by
  name or by tile kind, without details. Widening the kinds means a bigger Overpass query and index: measure first.
- Needs the area's map installed and indexed (and ideally the points fetched). Without it, the card says so; never
  a guess.
- OSM data: pharmacies on duty aren't in it; hours may be stale; the card always shows the data's date.
- Place-name ambiguity: ask, don't guess.
- False positives from a too-greedy parser are the main product risk: precision over recall, the model fallback
  for the rest.
- Privacy: everything stays on the device; SMS and sharing are the person's own action. No change to
  `site/privacy.html` (no new connection), except if trip prep's downloads add a source (they don't: existing
  catalogue).
