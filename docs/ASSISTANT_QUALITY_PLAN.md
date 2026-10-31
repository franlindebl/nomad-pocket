# Assistant quality: measurements and plan

Status: analysis done 2026-10-31, nothing changed in the app yet. The owner found the assistant nearly
useless in a crisis: Apple Intelligence refuses many questions ("how do I make fire", wounds) and the
answers it gives, like the GGUF model's, are poor. This measures why, on real content, and proposes fixes
in order. Bench and how to rerun it: `scripts/assistant-bench/README.md`.

## How it was measured

- **Data**: a fresh iOS 27 simulator (NP-ai) went through onboarding for Spain on production data. With
  Apple Intelligence available the kit offers **no downloadable model**; it took 12 guides (1.4 GB:
  `wikipedia_es_medicine_nopic`, `scoutwiki_es`, and ten English ones: zimgit medicine, water, food,
  knots, post-disaster; FAS military medicine; CDC; NHS medicines; two cooking sites) and the full Spanish
  Wikipedia without pictures (13.3 GB). The map was skipped (no effect on the assistant). The app's own
  `search.db` (PDF passages it extracted) was copied out.
- **Questions**: 50 in Spanish (`scripts/assistant-bench/questions.json`): fire, cold, shelter, water,
  food, first aid, medicines, pandemic, hygiene, blackout, communications, orientation, knots, war,
  disasters. The chat's starters are among them.
- **Engines**: Qwen3.5 4B Q4_K_M through `llama-server` (same GGUF, context 6144, 256-token thinking
  budget, the app's sampling and two-pass `search_library` flow); Apple's on-device model through
  FoundationModels on macOS 27 (the app's router, instructions and streamed generation, both guardrail
  modes); and the app itself in the simulator with Apple Intelligence.
- **Grading**: blind. For each question, the six variants' answers were shuffled under letters and scored
  0–3 by three independent graders (Claude agents briefed as emergency/first-aid experts, current
  ERC/AHA/Red Cross/WHO/FEMA guidance as the reference), with a flag for advice that could cause harm.
  3 = correct and actionable alone, 2 = useful but incomplete, 1 = barely useful, 0 = nothing / wrong /
  "not found".

## Results

| Variant | Mean (0–3) | Useful (≥2) | Good (3) | Zero | Harmful | "Not found" |
|---|---|---|---|---|---|---|
| **apple** — Apple FM, the app as is | **0.42** | 3 | 0 | 32 | 2 | 27 |
| **A** — Qwen 4B, the app as is | **1.30** | 21 | 8 | 14 | 3 | 12 |
| D — A + Spanish Ready.gov and MedlinePlus | 1.32 | 23 | 6 | 13 | 7 | 12 |
| B — Qwen, retrieval v2 | 1.48 | 27 | 10 | 13 | 8 | 13 |
| **C — retrieval v2 + Spanish content** | **1.94** | **35** | **19** | 7 | 6 | 5 |
| C′ — C with a looser rerank threshold | 1.84 | 35 | 12 | 5 | 7 | 4 |

One run per variant at temperature 0.5: differences under ~0.2 are noise (C vs C′). Median time per
answer on an M-series Mac GPU: 8–13 s (phones are slower; not measured here).

By topic (mean, A → C): fire 0.67 → 1.00, shelter 0.00 → 1.00 (2.00 in B/C′), water 0.80 → 1.40, food
1.00 → 1.60, first aid 2.29 → 2.50, medicines 1.50 → 3.00, blackout 0.75 → 2.00, war 1.00 → 2.33,
disasters 0.67 → 2.33. First aid was already the best topic (Spanish medical Wikipedia covers it).

## Findings

### 1. Apple Intelligence is not good enough to be the default

- Same library and prompts: mean 0.42, 32 of 50 answers worth nothing, 27 "No lo he encontrado" (Qwen:
  12). It gives up on long sources and its Spanish answers are thin.
- Guardrails: the router (search or not) failed with a guardrail error on 3 of 50 ("¿Cómo inmovilizo un
  hueso roto?", "¿Qué hago si un niño tiene fiebre muy alta?", and "¿Cómo cargo el móvil sin
  electricidad?"); the app then searches anyway. In the app, "¿Cómo hago fuego sin mechero ni cerillas?"
  streamed half an answer and ended in "El modelo integrado se ha negado a responder". On macOS 27 the
  same prompts streamed with no refusal (0/43 in both `.default` and `.permissiveContentTransformations`),
  so refusals depend on the OS and model version on the phone (the owner's iPhone refused most questions)
  and on the sampled text. `permissiveContentTransformations` costs one line and is meant for exactly this
  (transforming given text), but it could not be shown to help here.
- The router writes English queries for 21 of the 47 Spanish questions it routed ("how to start a fire when
  everything is wet"); `planRetrieval` drops them, so they are wasted, though they would be exactly what
  the English guides need (finding 3).

### 2. Retrieval bugs (cheap to fix)

- **Only the first 8 archives are searched.** `zim.ts` `search(itemIds, q, 8)` merges per-archive hits
  round-robin and stops at 8 hits in total. With the Spain kit's 13 archives, ordered newest install first
  (`listItems`), the five oldest (zimgit water, CDC, zimgit medicine, scoutwiki, NHS) almost never give a
  full-text hit; any archive added later pushes another one out. Per-archive limits fix it.
- **The same article twice.** `wikipedia_es_medicine` is a subset of `wikipedia_es_all`: 21 of 50 answers
  had duplicated sources (Herida + Herida, Hipotermia + Hipotermia), each copy taking one of the 6 article
  slots and context budget.
- **A tool call leaked as text**: in one run Qwen's second pass (`tool_choice: 'none'`) wrote
  `<tool_call><function=search_library>…` as its answer, shown raw to the person. Strip it like
  `stripThinking`, and fall back to a search answer.
- **Contradictory answer**: in the app Apple opened with "No lo he encontrado en tu biblioteca." and then
  answered from the sources with citations; `guardNotFound` only cuts answers that cite nothing.

### 3. A Spanish question never reaches the English guides

The kit's best survival material is English: US Army FM 21-76 Survival, SAS Survival Handbook, FM 21-11
First Aid, *Where There Is No Doctor*, Nuclear War Survival Skills, FEMA guides, water treatment guides.
Spanish keywords don't match English text, and the rankers drop chunks that share no words with the
question: **0 of 50 answers in A used any English guide**. The only practical Spanish content is
scoutwiki and Wikipedia, which is encyclopedic ("Técnicas para hacer fuego" lists *pistola de calor*;
"Poi (malabarismo)" was a source for lighting a fire in the wet).

### 4. Content alone doesn't help; content plus retrieval does

Adding Spanish Ready.gov (2.1 GB) and MedlinePlus (1.8 GB) with today's retrieval (D) changed nothing
(1.30 → 1.32): finding 2 keeps them out. With retrieval v2 (B → C) the same content took the mean from
1.48 to 1.94 and "not found" from 13 to 5: blackouts, floods, earthquakes, frozen food in an outage. Some
topics are simply missing from every archive (generators and carbon monoxide, getting news without
internet, family communication plans, waste without running water).

### 5. Harmful answers: the model garbles procedures

Every Qwen variant gave 3–8 answers out of 50 that could hurt someone: CPR with the person on their side,
2 cm deep or 15:2 at 60/min; choking with closed-fist blows; a viper bite bandaged tight; 2 drops of bleach
per gallon (8 is right); braziers or charcoal indoors; home-canned meat without a pressure canner; toxic
plants listed as edible. More retrieved text (B) gave more of them, not fewer: a 4B model paraphrasing
long, often English, sources into Spanish loses steps and mixes in its own memory. Better retrieval does
not fix this. Vetted short text does, quoted rather than rewritten (plan, step 6).

### 6. Is a preprocessing / vector step needed?

The assistant already does RAG, with indexes made in advance: each ZIM ships with a Xapian full-text index,
and the app indexes PDFs into SQLite FTS5 when they are downloaded. At question time it searches by
keywords, cuts articles into ~650-character chunks, ranks them (BM25) and hands the best to the model with
numbered citations. What a keyword index can't do is meaning across words and languages ("encender fuego"
vs "start a fire").

- A vector index of the whole library is not feasible on a phone: millions of Wikipedia articles would take
  days to embed and gigabytes to store.
- What worked in v2 is lighter: keyword search finds ~100 candidate chunks in both languages, then a small
  multilingual embedding model (EmbeddingGemma 300M, 320 MB GGUF, runs in llama.rn) reranks only those
  against the question. Spanish questions then match English passages. No preprocessing is needed. The
  cost on a phone (an extra model in memory, a few seconds per question) has not been measured yet.
- Precomputed vectors are worth it for a small curated pack (step 6): built on our side, shipped with it.

## Plan, in order

1. **Recommend Qwen even with Apple Intelligence** (small). Every Apple Intelligence iPhone has 8 GB, so
   the kit proposes Qwen3.5 4B there too and makes it the active model; Apple FM stays as a choice without
   a download. `SYSTEM_MODEL_RANK` goes below Qwen 2B (the system model is no longer the "better" one on
   these phones). Also try `SystemLanguageModel(guardrails: .permissiveContentTransformations)` for
   answers from sources, and keep the router's English query as a second query (step 4).
2. **Retrieval fixes** (small, `rag.ts`/`zim.ts`, unit tests): every archive's best hits (2–3 each)
   instead of the 8-hit round-robin; one copy per article title across archives; strip a leaked
   `<tool_call>` in pass 2; cut "not found" openings followed by a cited answer.
3. **Bench in the release checklist**: run `scripts/assistant-bench` before an assistant change (A as the
   baseline), and grow the questions to 100 with English ones.
4. **Bilingual retrieval** (medium): `search_library` takes `query_en` too (Qwen filled it in 150 of 150 calls); the
   Apple router's `@Generable` gets the same field; English archives are searched with it and their chunks
   ranked against it. Archive language comes from the catalog.
5. **Semantic rerank** (medium, needs a device measurement first): EmbeddingGemma 300M through llama.rn
   embeddings, downloaded with the chat model; rerank the candidates, drop those under ~0.40 cosine.
   Measure the time and memory on an iPhone 13 (4 GB) and 15 Pro before choosing; without it, step 4
   needs BM25 per language.
6. **A vetted bilingual emergency guide** (large, the real fix for finding 5 and the Spanish gap): ~150
   short protocol cards (CPR, choking, bleeding and tourniquet, burns, fractures, hypothermia, heat
   stroke, snake bite, dehydration and ORS, water disinfection with doses, food safety in an outage,
   carbon monoxide and generators, blackout, communications, shelter, fire, orientation, radiation and
   potassium iodide, earthquake, flood, evacuation), written in Spanish and English from public-domain US
   government sources (FEMA/Ready.gov, CDC, US Army FM 21-76 and FM 4-25.11), reviewed by a person with
   first-aid training. Tiny (~1 MB), part of every kit, searched first, and for life-critical protocols
   shown as the card itself, with the model only pointing to it. Health cards follow `HEALTH_FEATURES` on
   Android.
   **Owner's decisions (2026-10-31)**: the full guide, not first aid alone. No text of our own: each card is
   a faithful copy of an official public-domain source, with its reference, not reinterpreted. Use the
   official Spanish version where the agency publishes one (Ready.gov ES, CDC en español), otherwise a
   faithful translation marked as such. Vital protocols (CPR, choking, bleeding…) are answered with the card
   itself, unchanged, plus at most one line from the assistant.
   Open point: some public-domain sources are dated (FM 4-25.11 teaches pre-2010 CPR, before ERC/AHA's
   compressions first). Each vital card needs a current official source, or the card says it is out of date.
7. **Spanish content in the kit**: Ready.gov ES and MedlinePlus ES (2.1 + 1.8 GB) when there is room,
   after steps 2 and 4 (without them they don't help). Step 6 makes this less urgent.

## Limits of this measurement

- One run per variant; three graders (Claude agents, blind to the variant); no human review yet.
- Wikipedia `all_maxi` 2026-05 stood in for `all_nopic` 2026-10 on the host (same text). The app searches
  archives newest install first; the bench mirrors that order.
- Apple FM ran on macOS 27, not on the owner's iPhone, so its refusal rate here understates the phone's.
- Phone speed was not measured (Mac GPU only).
