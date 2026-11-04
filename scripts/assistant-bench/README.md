# Assistant bench

Measures the assistant on real content, off the phone: the app's retrieval (`rag.ts`, mirrored in
`bench.ts` on top of the real pure modules `rag-core.ts`, `library/html.ts`, `library/documents-core.ts`)
over the ZIM files a simulator downloaded in onboarding, answered by the same GGUF model through
`llama-server` with the app's two-pass tool flow (`chats.ts` + `engine.ts`), or by Apple's on-device model
(`fm/`, the `nomad-llm` router and generation). `questions.json` holds 50 crisis questions (Spanish). Results
are JSONL, one line per question: queries, sources, answer, time. First run: 2026-10-31,
`docs/ASSISTANT_QUALITY_PLAN.md`.

## Setup

1. A simulator with the onboarding kit downloaded (Spain: guides + Wikipedia). Copy its document index:
   `cp "$(xcrun simctl get_app_container <udid> com.fjlinde.nomadpocket data)/Documents/content/index/search.db" .`
   (the PDF passages, extracted by the app itself).
   Without a simulator: download the kit's ZIMs and build the index on the host (needs poppler):
   `venv/bin/python -I pdfindex.py pdfs.jsonl /tmp id=/path/a.zim …` then
   `node --experimental-strip-types mkdb.ts pdfs.jsonl search.db`, and serve the ZIMs with
   `venv/bin/python -I zimserver.py 8899 id=/path/a.zim …` (one Wikipedia per server to compare editions;
   `docs/ESSENTIAL_CONTENT.md` did it that way).
2. `python3 -m venv venv && ./venv/bin/pip install libzim`
3. ZIM server (mirrors `modules/nomad-zim` search / suggest / getContent):
   `./startzim.sh <udid> 8899 <wikipedia_es_all….zim> [extra.zim…]`
4. Model: `llama-server -m Qwen3.5-4B-Q4_K_M.gguf -c 6144 -np 1 --jinja --reasoning-budget 256 -ngl 99 --port 8080`
   (the app's context, thinking budget for the tool decision, GPU like a real iPhone).
5. For `--v2` only, embeddings: `llama-server -m embeddinggemma-300M-Q8_0.gguf --embedding --pooling mean -c 2048 -b 2048 -ub 2048 -np 4 --port 8081`

## Runs

```bash
node --experimental-strip-types bench.ts out.jsonl                 # the app as it is (GGUF, tools mode)
node --experimental-strip-types bench.ts out.jsonl 1 7 18          # some questions only
node --experimental-strip-types bench.ts out.jsonl --retrieval-only # sources only, no model
node --experimental-strip-types bench.ts out.jsonl --v2            # experimental retrieval (below)
```

Flags: `--zim=URL --llm=URL --emb=URL --db=search.db --questions=file --ctx=6144 --answer-tokens=768`;
`--guide` adds the emergency guide as the app has it (vital cards answer alone, others lead the sources), from
`src/data/guide.json` or `--guide-file=path`;
`--v2` with `--mincos=0.40 --pool=40 --articles=10 --per-archive=3`.

`APP_ORDER` in `bench.ts` is the order the app searches archives in (`listItems`: newest install first) for
the Spain kit; the search's round-robin depends on it.

Apple: `swift build -c release --package-path fm`, then
`node --experimental-strip-types mkroute.ts questions.json route-in.jsonl && fm/.build/release/fmbench route route-in.jsonl routes.jsonl`,
`node --experimental-strip-types bench.ts r.jsonl --sources --ctx=4000 --answer-tokens=600 --routes=routes.jsonl --emit=prompts.jsonl`,
then `fmbench generate <prompts with a prompt> out.jsonl [default|permissive]` (streamed, like the app).

In the app itself: `python3 -I insim.py out.jsonl <udid>` types each question in the simulator (assistant tab
open, iPhone 17 Pro) and records the screen, refusals included.

Grading: `python3 -I mkgrade.py grade/ A=a.jsonl B=b.jsonl …` writes blinded sheets (every variant's answer
to a question under a shuffled letter) and `key.json`.

## v2 (experiment, not in the app)

- Bilingual: the question's words search archives in its language; an English query (`query_en`, a second
  argument of the search tool) searches the English ones, and their chunks are ranked against it.
- Every archive's best hits (`searchAll`), not the round-robin capped at 8 hits that leaves the oldest
  installs out.
- One copy of an article found in two archives (medicine Wikipedia is inside the full one).
- Chunks reranked by EmbeddingGemma 300M (cosine to the question; nothing indexed in advance, only the
  candidates are embedded), dropping those under `--mincos` or 0.12 below the best.

## Guide search (no model)

`questions-design.json` (261) and `questions-test.json` (65, held out: never tune keywords on them) are crisis
questions written by agents playing 16 personas (2026-11-01). `gold-design.json` / `gold-test.json` say which guide
cards answer each one (labelled by agents against the 202 cards of 2026-11-01; relabel when cards change a lot).

```bash
node --experimental-strip-types evalmatch.ts questions-test.json gold-test.json      # V=1 lists misses
node --experimental-strip-types coverage.ts questions-test.json /tmp/cov.json         # what search finds per question
```
