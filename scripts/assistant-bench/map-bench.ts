// Map questions in the assistant (docs/ASSISTANT_MAP_PLAN.md): how many the parser takes, how many the model
// takes on top (phase 1b), and that crisis questions stay with the library.
//
//   node --experimental-strip-types map-bench.ts                       # parser only (no model)
//   node --experimental-strip-types map-bench.ts --llm=http://localhost:8080 [--out=map.jsonl]
//   node --experimental-strip-types map-bench.ts --routes=routes.jsonl     # Apple's router (fmbench route, mkroute --map)
//   node --experimental-strip-types map-bench.ts --rescore=map.jsonl       # a model run's calls, scored again (no model)
//
// The model stage mirrors the app's tools pass (chats.ts + engine.ts): search_library and search_map offered,
// the tools system prompt plus MAP_TOOL_RULE, thinking on for the decision. It asks only what the parser left
// (gold-map.json misses, and every crisis question of questions*.json the parser didn't take).
// llama-server as in README.md (Qwen3.5 4B, -c 6144 --jinja --reasoning-budget 256).
import { readFileSync, writeFileSync } from 'node:fs';

const core = await import(new URL('../../src/features/assistant/map-intent-core.ts', import.meta.url).href);
const rag = await import(new URL('../../src/features/assistant/rag-core.ts', import.meta.url).href);

type Expect = { kind: string; kinds?: string[]; place?: string } | null;
type Gold = { id: string; q: string; expect: Expect };
type Crisis = { id: number | string; q: string };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const LLM = arg('llm');
const ROUTES = arg('routes');
const RESCORE = arg('rescore');
const OUT = arg('out');
const here = (f: string) => new URL(f, import.meta.url);

// --gold=gold-map-test.json: the held-out set (never tune the parser or intentFromModel on it).
const gold: Gold[] = JSON.parse(readFileSync(here(arg('gold') ?? 'gold-map.json'), 'utf8'));
// --no-crisis: the map questions only (a quick model run).
const CRISIS = !process.argv.includes('--no-crisis');
const crisis: Crisis[] = ['questions.json', 'questions-design.json', 'questions-test.json'].flatMap((f) => JSON.parse(readFileSync(here(f), 'utf8')));

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The text of the place an intent is about (its destination for a route), '' for "here". */
function placeOf(intent: any): string | null {
  const ref = intent.kind === 'route' ? intent.to : (intent.near ?? intent.from ?? intent.place);
  if (!ref) return null;
  if (ref.here) return '';
  return ref.text ?? ref.name ?? null;
}

/** Whether an intent answers what the gold expects: the kind (a route to a kind may be goNearest), a kind in common, the place. */
function matches(intent: any, e: Exclude<Expect, null>): boolean {
  if (!intent) return false;
  // "El ayuntamiento de Getafe" as a destination: town halls near Getafe (nearby) is the same answer.
  const kindOk = intent.kind === e.kind || (e.kind === 'route' && (intent.kind === 'goNearest' || (!!e.kinds && intent.kind === 'nearby'))) || (e.kind === 'goNearest' && intent.kind === 'nearby') || (e.kind === 'nearby' && intent.kind === 'goNearest');
  if (!kindOk) return false;
  if (e.kinds && intent.kinds && !e.kinds.some((k) => intent.kinds.includes(k))) return false;
  if (e.place !== undefined) {
    const p = intent.kind === 'goNearest' && e.kind === 'route' ? placeOf({ ...intent, kind: 'nearby' }) : placeOf(intent);
    if (p === null) return false;
    if (e.place === '' ? p !== '' : !norm(p).includes(e.place)) {
      // "Getafe" as the place of "el ayuntamiento de Getafe": the route's destination text holds it.
      if (!(e.place && JSON.stringify(intent).includes(e.place))) return false;
    }
  }
  return true;
}

// --- Parser -------------------------------------------------------------------

const rows: object[] = [];
let parserHits = 0;
const left: Gold[] = [];
for (const g of gold) {
  const intent = core.parseMapIntent(g.q);
  const ok = g.expect ? matches(intent, g.expect) : !intent;
  if (ok) parserHits++;
  else left.push(g);
  rows.push({ stage: 'parser', id: g.id, q: g.q, ok, intent });
}
const falseParser = crisis.map((c) => ({ c, intent: core.parseMapIntent(c.q) })).filter((x) => x.intent);
console.log(`parser: ${parserHits}/${gold.length} map questions right; ${falseParser.length}/${crisis.length} crisis questions taken as map questions`);
for (const { c, intent } of falseParser) console.log(`  FP ${c.id}: ${c.q} → ${JSON.stringify(intent)}`);
if (process.env.V) for (const g of left) console.log(`  miss ${g.id}: ${g.q} → ${JSON.stringify(core.parseMapIntent(g.q))}`);

// --- Model --------------------------------------------------------------------

async function decide(q: string): Promise<{ tool: string | null; args?: string; ms: number }> {
  const lang = rag.detectLanguage(q, 'es');
  const system = `${rag.systemPrompt(lang, 'tools', { library: true })}\n${core.MAP_TOOL_RULE[lang]}`;
  const started = Date.now();
  const r = await fetch(`${LLM}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: q },
      ],
      tools: [rag.searchToolSpec(lang), core.mapToolSpec(lang)],
      tool_choice: 'auto',
      max_tokens: 768,
      temperature: 0.5,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      chat_template_kwargs: { enable_thinking: true },
    }),
  });
  const j: any = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  return { tool: call?.function?.name ?? null, args: call?.function?.arguments, ms: Date.now() - started };
}

if (LLM) {
  let modelHits = 0;
  for (const g of left) {
    const d = await decide(g.q);
    const intent = d.tool === core.MAP_TOOL_NAME ? core.intentFromModel(core.parseMapToolArgs(d.args), g.q) : null;
    const ok = g.expect ? matches(intent, g.expect) : !intent;
    if (ok) modelHits++;
    rows.push({ stage: 'model', id: g.id, q: g.q, ok, tool: d.tool, args: d.args, intent, ms: d.ms });
    console.log(`${ok ? 'ok  ' : 'MISS'} ${g.id} ${d.tool ?? '-'} ${d.args ?? ''} (${d.ms} ms)`);
  }
  let mapCalls = 0;
  let mapAnswers = 0;
  const asked = CRISIS ? crisis.filter((c) => !core.parseMapIntent(c.q)) : [];
  for (const c of asked) {
    const d = await decide(c.q);
    if (d.tool !== core.MAP_TOOL_NAME) continue;
    mapCalls++;
    const intent = core.intentFromModel(core.parseMapToolArgs(d.args), c.q);
    if (intent) mapAnswers++;
    rows.push({ stage: 'model-crisis', id: c.id, q: c.q, tool: d.tool, args: d.args, intent, ms: d.ms });
    console.log(`  FP? ${c.id}: ${c.q} → ${d.args} → ${intent ? JSON.stringify(intent) : 'dropped (library instead)'}`);
  }
  console.log(`model: ${modelHits}/${left.length} of the parser's misses right; ${mapCalls}/${asked.length} crisis questions called search_map, ${mapAnswers} became map answers`);
  console.log(`total: ${parserHits + modelHits}/${gold.length} map questions answered right`);
}

// --- A model run scored again (after changing intentFromModel) -----------------------

if (RESCORE) {
  const prev = readFileSync(RESCORE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(gold.map((g) => [g.id, g]));
  let hits = 0;
  let fps = 0;
  for (const r of prev) {
    if (r.stage === 'model') {
      const g = byId.get(r.id);
      if (!g || !left.some((x) => x.id === g.id)) continue;
      const intent = r.tool === core.MAP_TOOL_NAME ? core.intentFromModel(core.parseMapToolArgs(r.args), g.q) : null;
      const ok = g.expect ? matches(intent, g.expect) : !intent;
      if (ok) hits++;
      console.log(`${ok ? 'ok  ' : 'MISS'} ${g.id} ${r.tool ?? '-'} ${r.args ?? ''} → ${JSON.stringify(intent)}`);
    } else if (r.stage === 'model-crisis') {
      const intent = core.intentFromModel(core.parseMapToolArgs(r.args), r.q);
      if (intent) fps++;
      console.log(`  FP? ${r.id}: ${r.q} → ${r.args} → ${intent ? JSON.stringify(intent) : 'dropped'}`);
    }
  }
  console.log(`rescored: ${hits}/${left.length} of the parser's misses right; ${fps} crisis questions became map answers`);
  console.log(`total: ${parserHits + hits}/${gold.length} map questions answered right`);
}

// --- Apple's router ---------------------------------------------------------------

if (ROUTES) {
  const routes = new Map<string, any>(
    readFileSync(ROUTES, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((r) => [String(r.id), r]),
  );
  const said = (r: any) => ({ action: r.mapAction, category: r.mapCategory, place: r.mapPlace, destination: r.mapDestination });
  let hits = 0;
  for (const g of left) {
    const r = routes.get(g.id);
    if (!r || r.error) {
      console.log(`ERR  ${g.id} ${r?.error ?? 'no route'}`);
      continue;
    }
    const intent = r.map ? core.intentFromModel(said(r), g.q) : null;
    const ok = g.expect ? matches(intent, g.expect) : !intent;
    if (ok) hits++;
    rows.push({ stage: 'router', id: g.id, q: g.q, ok, route: r, intent });
    console.log(`${ok ? 'ok  ' : 'MISS'} ${g.id} map=${r.map} ${r.mapAction}|${r.mapCategory}|${r.mapPlace}|${r.mapDestination} search=${r.search} (${r.ms} ms)`);
  }
  let mapCalls = 0;
  let mapAnswers = 0;
  let noSearch = 0;
  const asked = crisis.filter((c) => !core.parseMapIntent(c.q));
  for (const c of asked) {
    const r = routes.get(String(c.id));
    if (!r || r.error) continue;
    // The app looks a map question the map can't take up in the library; only map=false, search=false skips it.
    if (!r.map && !r.search) noSearch++;
    if (!r.map) continue;
    mapCalls++;
    const intent = core.intentFromModel(said(r), c.q);
    if (intent) mapAnswers++;
    console.log(`  FP? ${c.id}: ${c.q} → ${r.mapAction}|${r.mapCategory}|${r.mapPlace} → ${intent ? JSON.stringify(intent) : 'dropped (library instead)'}`);
  }
  console.log(`router: ${hits}/${left.length} of the parser's misses right; ${mapCalls}/${asked.length} crisis questions set map, ${mapAnswers} became map answers; ${noSearch} crisis questions neither searched nor mapped`);
  console.log(`total: ${parserHits + hits}/${gold.length} map questions answered right`);
}

if (OUT) writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
