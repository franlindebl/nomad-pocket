// Guide coverage of a question set, no model involved:
//   node --experimental-strip-types coverage.ts questions.json out.json
// For each question in a JSON file ([{q, cat}]): the card that would answer alone (vital / all), the source cards, the top matches.
const root = new URL('../..', import.meta.url).pathname;
import { readFileSync, writeFileSync } from 'node:fs';
const gc = await import(`${root}/src/features/guide/guide-core.ts`);
const rc = await import(`${root}/src/features/assistant/rag-core.ts`);
const cards = JSON.parse(readFileSync(`${root}/src/data/guide.json`, 'utf8')).cards;
const idx = new gc.GuideIndex(cards, 'es');
const qs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = qs.map((x: any, i: number) => {
  const search = rc.guessIntent(x.q, []) === 'search';
  return {
    i, q: x.q, cat: x.cat,
    vital: search ? gc.answerCard(idx, x.q, [], 'vital')?.id ?? null : null,
    any: search ? gc.answerCard(idx, x.q, [], 'all')?.id ?? null : null,
    sources: gc.sourceCards(idx, x.q).map((c: any) => c.id),
    top: idx.match(x.q, 3).map((m: any) => `${m.card.id} cov=${m.coverage.toFixed(2)} reach=${m.reach.toFixed(2)}`),
  };
});
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
const n = out.length;
console.log(`${n} questions: vital ${out.filter((o: any) => o.vital).length}, any card ${out.filter((o: any) => o.any).length}, some source ${out.filter((o: any) => o.sources.length).length}, nothing ${out.filter((o: any) => !o.sources.length && !o.any).length}`);
