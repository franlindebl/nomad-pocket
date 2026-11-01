// Guide search accuracy against gold labels (which card answers each question), no model involved:
//   node --experimental-strip-types evalmatch.ts questions-test.json gold-test.json [guide.json]   (V=1 lists the misses)
// gold: [{id, answeredBy: [card ids], coverage}]
const root = new URL('../..', import.meta.url).pathname;
import { readFileSync } from 'node:fs';
const gc = await import(`${root}/src/features/guide/guide-core.ts`);
const rc = await import(`${root}/src/features/assistant/rag-core.ts`);
const cards = JSON.parse(readFileSync(process.argv[4] ?? `${root}/src/data/guide.json`, 'utf8')).cards;
const ids = new Set(cards.map((c: any) => c.id));
const idx = new gc.GuideIndex(cards, 'es');
const qs = new Map(JSON.parse(readFileSync(process.argv[2], 'utf8')).map((q: any) => [q.id, q.q]));
const gold = JSON.parse(readFileSync(process.argv[3], 'utf8')).filter((g: any) => g.coverage !== 'out-of-scope');
let n = 0, srcHit = 0, srcAny = 0, ansN = 0, ansOk = 0, vitN = 0, vitOk = 0, noGoldSrc = 0, noGoldN = 0;
const wrong: string[] = [], missed: string[] = [];
for (const g of gold) {
  const q = qs.get(g.id) as string; if (!q) continue;
  const good = new Set(g.answeredBy.filter((x: string) => ids.has(x)));
  const search = rc.guessIntent(q, []) === 'search';
  const src = gc.sourceCards(idx, q).map((c: any) => c.id);
  const ans = search ? gc.answerCard(idx, q, [], 'all') : null;
  const vit = search ? gc.answerCard(idx, q, [], 'vital') : null;
  if (!good.size) { noGoldN++; if (src.length) noGoldSrc++; if (ans) wrong.push(`#${g.id} [no card] → ${ans.id}: ${q}`); continue; }
  n++;
  if (src.some((x: string) => good.has(x))) srcHit++; else missed.push(`#${g.id} want ${[...good].join('/')} got ${src.join(',') || '-'}: ${q}`);
  if (src.length) srcAny++;
  if (ans) { ansN++; if (good.has(ans.id)) ansOk++; else wrong.push(`#${g.id} want ${[...good].join('/')} → ${ans.id}: ${q}`); }
  if (vit) { vitN++; if (good.has(vit.id)) vitOk++; }
}
console.log(`questions with a gold card: ${n}; gold among sources: ${srcHit} (${(100 * srcHit / n).toFixed(0)}%)`);
console.log(`answer-alone (all): ${ansN} answered, ${ansOk} right (${ansN ? (100 * ansOk / ansN).toFixed(0) : 0}% precision, ${(100 * ansOk / n).toFixed(0)}% of questions)`);
console.log(`answer-alone (vital): ${vitN} answered, ${vitOk} right`);
console.log(`no gold card: ${noGoldN}, of which got some source: ${noGoldSrc}`);
if (process.env.V) { console.log('\nWRONG ANSWERS'); wrong.forEach((x) => console.log(x)); console.log('\nMISSED SOURCES'); missed.forEach((x) => console.log(x)); }
