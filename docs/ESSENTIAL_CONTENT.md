# Essential content: what the onboarding kit downloads

Status: done 2026-11-04 (owner's decisions below). What "Essential" means in the catalog, why each archive is
or isn't in it, and which Wikipedia the kit proposes, with the measurements behind it.

## The rule

- **Essential = the onboarding kit.** Every collection's first level, when it is the recommended tier
  (`recommended: true` in `src/data/catalog.json`), is what the kit downloads, whole
  (`features/onboarding/kit-core.ts`). Before, the kit took three collections (medicine, survival,
  agriculture) and dropped any archive over 300/100 MB, plus `zimgit-post-disaster_en` from the
  *Complete* level by hand: half of "Essential" never came, and DIY and Education never did.
- **What belongs in Essential**: it helps in a crisis or a long time without internet, it is light
  (≲ 700 MB, `check:catalog` warns above), text or PDF rather than video, in the person's language when there
  is one, and not already inside another archive of the kit.
- **A collection may have no Essential level.** Computing's first level is "Básico" / "Basic", not
  recommended, not in the kit (the validator allows it; a recommended tier, when there is one, must be the first).
- Curation lives in the catalog, not in caps in the code. The Library's "Nivel 1 · Esencial" and the
  kit list the same archives.

## Essential, per collection (2026-11-04)

| Collection | Essential | Moved out |
|---|---|---|
| Medicine (iOS only) | Wikipedia médica es (171 MB), NHS medicines (15), military medicine (76), zimgit medical library (70, skipped next to post-disaster) | CDC travellers' health (178) → Standard: vaccines and travel, not a crisis |
| Survival | WikiRoca es (20), **zimgit post-disaster** (645, from Complete; iOS only, it is mostly first aid), zimgit water (21), knots (28), food (98): the last three only where post-disaster isn't (Android) | Canadian Prepper winter (1342) and bug-out bag (879) → Complete: English videos |
| Education | Wikilibros (112), Wikiviajes (43), Vikidia (16); for English readers Vikidia en (11) and Wikivoyage en (272), new, `sameAs` the Spanish ones | Wikiquote → Standard; English Wikibooks (3508) → Standard |
| DIY | woodworking (107) and mechanics (342) Stack Exchange, unchanged but now downloaded | — |
| Agriculture | **Gardenology** (112, new: how to grow each plant, compost, seed saving; some pages show raw template fields), FOSS cooking (24), Based.Cooking (16) | TED gardening (326) → Standard: talks, not instructions |
| Computing | none | its first level is "Básico" |

Kit totals (guides only): Spanish iOS 13 archives, 1.7 GB (was 12, 1.36 GB with 217 MB duplicated);
Spanish Android 12, 0.94 GB (was 6, 0.21 GB); English iOS 10, 1.6 GB; English Android 10, 1.0 GB.
The map of the country and the assistant model are unchanged.

### zimgit post-disaster carries four other archives

`zimgit-post-disaster_en_2024-05` (108 PDFs) holds every PDF of `zimgit-medicine_en_2024-08` (12),
`zimgit-water_en_2024-08` (7), `zimgit-knots_en_2024-08` (11) and `zimgit-food-preparation_en_2025-04` (17),
byte for byte (same sizes, checked with libzim on the catalog's files): 194 MB the kit downloaded twice, and
passages the assistant found twice. `editions-core.ts` (`CARRIES`) treats it like a bigger edition: packs and
the kit skip the four next to it, their rows say "Ya está dentro de «Después del desastre»", and downloading it
offers to delete them (`library/redundant.ts`). On Android post-disaster is hidden (first aid), so the four
come back. Recheck when one of them gets a newer file.

## Wikipedia: the top articles, not the whole encyclopedia

The kit proposed the whole Wikipedia without pictures (13.3 GB, `all-nopic`) whenever 60 GB stayed free:
three quarters of the kit's bytes. Now it proposes the 50 000 best articles in full (`top-nopic`, 1.2 GB),
or their intros (`top-mini`, 217 MB) when space is short. The whole one stays in the Library.

### Measurements (2026-11-04)

**Assistant bench** (`scripts/assistant-bench`, 50 crisis questions in Spanish, Qwen3.5 4B, the emergency guide,
the kit's guides with their PDFs indexed; only the Wikipedia changed; blind-graded 0–3 by three graders).
17 questions are answered by a guide card, the same in every variant; the table is the other 33:

| Wikipedia | Size | Mean | Useful (≥ 2) | Zero | Harmful (2 of 3 graders) |
|---|---|---|---|---|---|
| `all_nopic` (as it was) | 13.3 GB | 2.07 | 23 | 2 | 2 |
| `top_nopic` | 1.2 GB | 2.29 | 28 | 0 | 1 |
| `all_mini` | 4.1 GB | 2.30 | 26 | 0 | 2 |
| none | 0 | 2.09 | 25 | 1 | 2 |

The differences are within the noise (one run per variant; a variant moved ±0.15 between rounds before), but
the whole encyclopedia doesn't help: it scores like no Wikipedia at all. Answers come from the guides: the
post-disaster library is the most cited source (78–96 citations per variant), then the emergency guide and
military medicine; without Wikipedia the assistant cites the medical Wikipedia more. The harmful answers are the
model's own paraphrasing (lighting a fire inside the tent) and appear with any variant.

**Coverage** of 121 crisis articles (hypothermia, water disinfection, tourniquet, blackout, knots, shelter,
earthquake, CPR, carbon monoxide…), all in the full Spanish Wikipedia:

- `top_nopic` has 93 (76 %). Of the 28 missing, the medical Wikipedia has six (recovery position, tourniquet,
  fracture, bee sting, oral rehydration salts, face mask); the rest (blackout, shelter, knots, evacuation,
  solar water disinfection, distress signal…) are what the guides and the emergency guide cover.
- `all_mini` keeps only each article's introduction: a median **12 %** of the text (p25 7 %, p75 22 %). In
  "Hipotermia" it loses the causes, symptoms, prevention and treatment sections. Same assistant score as
  `top_nopic`, 3.4 times bigger and worse to read.

### How it was measured

ZIMs on the host (catalog versions; `wikipedia_es_all_maxi_2026-05` stood in for `all_nopic`, same text),
PDF passages indexed like `documents.ts` with `pdftotext` (`scripts/assistant-bench/pdfindex.py` +
`mkdb.ts`, no simulator needed), `zimserver.py` per variant, `bench.ts --guide`, then `mkgrade`-style blind
sheets of the 33 model-answered questions × 4 variants. Limits: one run per variant, graders are Claude agents
(no human review), questions are crisis questions only, so they don't measure the whole Wikipedia's value
for looking things up, which is why it stays one tap away in the Library.

## Kiwix archives worth a look later

Not in the catalog, found in the Kiwix library (3 656 books) on 2026-11-04: Appropedia (581 MB,
appropriate technology, a candidate for DIY Essential instead of woodworking), energypedia (722 MB nopic),
trueprepper.com (1.4 GB), Simple English Wikipedia (1.1 GB nopic), armypubs (8.2 GB), mdwiki (2.3 GB maxi).
Spanish crisis content is scarce: beyond what we ship, little more than Wikiversidad (15 MB) and topical
Wikipedias (geography, history).
