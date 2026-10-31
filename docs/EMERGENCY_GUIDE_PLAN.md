# Emergency guide: sources and decisions

Status: source inventory done 2026-10-31, no card written yet. Step 6 of `docs/ASSISTANT_QUALITY_PLAN.md`: a
bilingual guide of short official texts that the assistant searches first and, for vital protocols, shows as
they are. Owner's rules (2026-10-31): the whole guide, **no text of our own** (faithful copies of official
sources that may legally be reproduced, each with its reference), official Spanish versions first, vital cards
shown verbatim. Health cards follow `HEALTH_FEATURES` (hidden on Android).

Files in `docs/emergency-guide/`: `cards.md` (the 94 cards), `matrix.md` (status per card), and the four
inventories, one table row per card with the URLs that were opened, dates, licence and caveats:
`sources-1-first-aid.md` (sections 1–2), `sources-2-water-food-power.md` (3–6, 11),
`sources-3-shelter-disasters.md` (7–10, 13), `sources-4-survival-licences.md` (12, and the licence check).

## Licences (verified on each site's legal page)

| Source family | May we copy it into the app? | Conditions |
|---|---|---|
| US federal works (CDC, NIOSH, FDA, FEMA/Ready.gov, NPS, DHS/CISA, NOAA, USGS, SAMHSA, NLM) | Yes, public domain (17 U.S.C. §105) | Credit the agency; no logos; images checked one by one (some are licensed). CDC asks for no substantive changes. |
| MedlinePlus | Only the NLM-written health-topic summaries (EN and ES) | **Not** the A.D.A.M. encyclopedia (`/ency/`) or ASHP drug pages. |
| US Army manuals marked "Distribution A" (ATP 4-02.11 first aid, 2026; ATP 3-50.21 survival, 2018) | Yes | No insignia. **Not** FM 3-05.70 (restricted now) or the older FM 4-25.11 / TC 4-02.1 (superseded). |
| Spanish government (Protección Civil, Interior, Sanidad, AESAN, INSST, AEMPS, IGN, Defensa) | Yes, Ley 37/2007, commercial use included | Cite the source ("Origen de los datos: …"), give the last-update date, don't change the meaning, don't imply endorsement. Defensa: CC BY-SA. |
| European Commission | Yes, CC BY 4.0 | Credit, and mark a translation as a change. |
| **Guardia Civil, Ministerio de Justicia (toxicology service)** | **No** (private use only) | Facts such as the phone number 91 562 04 20 can be stated; their text can't. |
| **WHO** (CC BY-NC-SA 3.0 IGO) | Avoid | Non-commercial and share-alike clash with the GPL app and would bind our translations. |
| Red Cross, AHA, ERC, Mayo, NGOs | No (copyright) | Only with written permission. |

## What the inventory found

| | Cards (of 94) |
|---|---|
| English: current reusable source / thin or partly outdated / none | 71 / 18 / 5 |
| Spanish: same agency's official version / Spanish-government text / needs a faithful translation / none | 53 / 13 / 23 / 5 |
| A tempting source that must not be used (named in `matrix.md`) | 21 |
| Sources that contradict each other | 10 |

- **English is well covered**: almost every card has a current US federal source. The new US Army first-aid
  manual (ATP 4-02.11, March 2026) follows current guidance (compressions first, 100–120/min, 5 back blows then
  abdominal thrusts, tourniquet for life-threatening bleeding, no tourniquet or cutting for snake bites), but it
  reads military ("Service member", DD Form 1380) and has no Spanish version.
- **Spanish is the weak side**: many CDC, NIOSH, FDA, NIH and Ready.gov pages have the agency's own Spanish
  version, often older than the English one. Spain's own bodies say 112 and fit Spain (Protección Civil, Sanidad,
  AESAN, INSST, IGN), but mostly as image-only infographics without dates or English. The rest needs a faithful
  translation.
- **Official sources that must not be copied, though they look right**:
  - Protección Civil's earthquake infographic ("bajo los dinteles de las puertas": contradicts drop-cover-hold on;
    use IGN 2020 or Ready.gov/es);
  - INSST NTP 467 (choking: "never strike the back"), NTP 469 (pressure points, Trendelenburg), NTP 246
    (neutralising acids with bicarbonate);
  - Ready.gov/es and FEMA 2004's "16 drops of bleach per gallon" (double the CDC/EPA dose);
  - the US Army manual's unresponsive-choking paragraphs (rescue breaths and "6 to 10 thrusts" instead of CPR).
- **No current reusable source at all** (5 cards, both languages): infant choking, swallowed poisons (only "call
  Poison Control"), drowning rescue, emergency childbirth (only a 1960s civil-defence booklet), toilets without
  running water. Close to it: child and infant CPR beyond one paragraph, the recovery-position roll, a home-made oral
  rehydration recipe, distress signals, war and air raids in Spanish
  (the EU's 72-hour citizen guidance is promised for 2026), and a bleach dose for Spanish lejía (3.5–6 %, by law)
  in drops per litre.
- **Sources contradict each other** (boiling at altitude, toilet-tank water, how to disinfect cans, fridge 40 °F vs
  5 °C): each card follows one source, never a mix.
- **US details travel with a faithful copy**: 911, US Poison Control, °F, gallons, inches, US brands and species.

## Decisions for the owner

1. **Is a faithful translation "copying"?** 23 cards have no official Spanish text (many first-aid steps, all of
   outdoor survival). Options: (a) yes, marked "Traducción fiel de <fuente>" with the original
   linked, reviewed sentence by sentence; (b) no: those cards only in the language their source has.
2. **Excerpts.** Many sources are long pages or manual chapters: may a card be an excerpt (whole sentences and
   paragraphs left out, nothing reworded, marked "Fragmento")? Without it the US-system cards (alerts, documents,
   disability) and the Army manual are unusable.
3. **US details.** A copy keeps "call 911", °F and gallons. Options: (a) keep the text as it is and show a fixed note
   outside it ("En España: 112 · 91 562 04 20 Información Toxicológica"), with metric equivalents in brackets marked
   as ours; (b) prefer the Spanish-government text wherever one exists, even if EN and ES then differ.
4. **Gaps.** For the cards with no reusable source: (a) leave them out and let the assistant say so; (b) a card that
   only says what the official sources do say (call 112, the number) and nothing more; (c) ask Cruz Roja Española or
   the Consejo Español de RCP for permission to reproduce their protocols (infant choking, paediatric CPR,
   drowning, childbirth), which would close the most important gaps.
5. **Lejía.** No official Spanish dose in drops per litre exists. Options: the CDC/EPA table as it is (for 6 % and
   8.25 %, with a note that Spanish lejía is 3.5–6 % and the label rules), or no dose (boiling only).

### Owner's answers (2026-10-31)

1. Translation: **yes**, a faithful sentence-by-sentence translation marked "Traducción fiel de <fuente>", original
   linked.
2. Excerpts: **yes**, whole sentences or paragraphs left out, nothing reworded, marked "Fragmento".
3. US details: **text as it is plus a fixed note outside it** ("En España: 112 · Información Toxicológica 91 562 04
   20"), metric equivalents in brackets marked as ours.
4. Gaps: the owner asked to reproduce them anyway from the original sources, credited. Not possible as such: the ERC
   2025 guidelines are "© European Resuscitation Council 2025. All rights reserved" with no reproduction without the
   ERC's permission, and so are Red Cross and AHA; credit is not a licence. Asking for permission would take too long,
   so **for the five gap cards only, our own wording of the current guidance** (ERC 2025, WHO, CDC): procedures are
   not protected, their wording is. Each such card says "Redactado por Nomad Pocket según <guía, año>" (never passed
   off as an official text), every sentence is checked against the guideline it follows, and a review by someone with
   first-aid training is welcome later (not blocking).
5. Lejía: not answered yet (default: the CDC/EPA table as it is, with the note on Spanish concentrations).

## Pilot (next, approved 2026-10-31)

Vital first aid first: it is where the harmful answers left after step 4 are (CPR, choking, viper bite,
recovery position; `docs/ASSISTANT_QUALITY_PLAN.md`). Cards: 1.1 CPR adult, 1.2 CPR child/infant, 1.3 choking,
1.4 infant choking (own wording), 1.5 bleeding, 1.6 tourniquet, 1.7 recovery position, 1.8 shock, 1.9 burns,
1.16 hypothermia, 1.18 heat stroke, 1.20 snake bite, 1.22 anaphylaxis, 1.23 swallowed poison (own), 1.24 carbon
monoxide, 1.25 drowning (own), 1.27 stroke, 1.28 heart attack, 1.30 childbirth (own), 11.5 toilets without water
(own), 3.2 bleach doses (frequent harmful answer). Sources and caveats per card: `docs/emergency-guide/sources-*.md`.

Design (proposed; adjust while building):
1. **Card files**: `src/data/guide/<id>.<lang>.md` (e.g. `1.1.es.md`) with front matter: `title`, `section`, `health`
   (true for sections 1–2 and health-ish cards), `vital`, `kind` (`copy` | `excerpt` | `translation` | `own`),
   `source` (agency, title), `url`, `date` (as the page shows it), `licence` line, `keywords` (search terms people use,
   both languages' synonyms), and for a translation the original's id. Body: Markdown, the source's text only.
   Excerpts mark omissions with "[…]"; our metric equivalents go in brackets as "[≈ 2 L, nota de Nomad]".
2. **Build**: `scripts/guide/build.mjs` → `src/data/guide.json` (bundled, ~100–200 KB); `--check` fails if stale
   (like `licenses.mjs`). Validates front matter and that every card has both languages.
3. **Source check**: `scripts/guide/check-sources.mjs` fetches each `copy`/`excerpt` URL (cached under the
   scratchpad, never in the repo) and verifies every sentence of the card appears in the source text (normalized
   whitespace, quotes); prints the misses. Translations are checked against their original card by a human/agent
   pass, sentence by sentence; `own` cards list the guideline lines they follow in a `basis` field.
4. **Retrieval** (`features/assistant/guide-core.ts`, pure and tested): BM25 over the cards of the question's language
   (title ×3, keywords ×2, body), `matchGuide(question, lang)` → scored cards. In `rag.ts` the best matches join the
   ranking as sources ahead of the library (source id `guide:<id>`, its chip opens the card). **Vital**: when the
   best match is a vital card above a threshold, the answer *is* the card, word for word, with its source line, and
   the model adds nothing (no generation call); a header line says it's the official text. Health cards are dropped
   when `HEALTH_FEATURES` is false.
5. **Fixed note** under every card that mentions 911/°F/gallons: "En tu país: <emergencyNumber()>" (the country's
   number from `features/maps/emergency`), plus Spain's toxicology number on poison cards.
6. **UI**: the card as Markdown in the chat bubble; a guide screen (list by section, search, card view with its
   source and licence); entry from Home's "Primeros auxilios" quick action (today it opens a Wikipedia article).
7. **Measure**: mirror `guide-core` in `scripts/assistant-bench/bench.ts`, rerun the 50 questions, blind-grade against
   A4 (`mergeRanked` 8/0.4, the code on main); target: no harmful answers on the pilot's topics.

## Bench state (to resume)

- Data: simulator NP-ai `87957D59-2FE2-4EC0-A9DB-5069E6FB4A50` (iOS 27, Spain kit downloaded, Apple Intelligence),
  NP-ai2 `F6D8E91E-7FEA-4F61-ACCD-700DF51E319B` (new onboarding check, Qwen 4B downloaded). Host files:
  `~/Proyectos/nomad/data/models/` (Qwen3.5-4B, embeddinggemma-300M), `~/Proyectos/nomad/data/zim/` (Wikipedia es
  maxi used as the nopic stand-in), `~/Proyectos/nomad/data/zim-extra/` (Ready.gov ES, MedlinePlus ES).
- Servers (`scripts/assistant-bench/README.md`): `llama-server` Qwen on :8080, embeddings on :8081, ZIM kit on :8899,
  kit + Spanish extras on :8898. The bench needs `search.db` copied from NP-ai next to `bench.ts` and a venv with libzim.
- Results so far (JSONL, scratchpad of the 2026-10-31 session, not in the repo): A (as was), A2 (steps 1–2), A3/A4
  (step 4, 16 vs 8 chunks), A3x, B/C/C′/D (experiments), apple*. Numbers are in `docs/ASSISTANT_QUALITY_PLAN.md`.

## After the pilot

Write the remaining cards (text copied, never generated), each with source, URL, date and licence line;
a check that compares each card with its source text; the guide shipped in the app (small, bilingual, searched
first by the assistant, vital cards shown whole); then the bench again.
