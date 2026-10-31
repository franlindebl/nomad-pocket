#!/usr/bin/env node
// Builds src/data/guide.json, the emergency guide bundled with the app, from the card files in
// src/data/guide/<id>.<lang>.md (format: docs/emergency-guide/FORMAT.md). One entry per card with both
// languages; fails on a card missing a language, on languages that disagree about the card (number, vital,
// health, related cards) and on a related card that doesn't exist.
//   node scripts/guide/build.mjs           write src/data/guide.json
//   node scripts/guide/build.mjs --check   exit 1 if the committed file is stale
import fs from 'node:fs';
import path from 'node:path';

import { LANGS, readCards, root } from './cards.mjs';

const outFile = path.join(root, 'src/data/guide.json');

const byId = new Map();
for (const c of readCards()) {
  const entry = byId.get(c.id) ?? { langs: {} };
  entry.langs[c.lang] = c;
  byId.set(c.id, entry);
}

const errors = [];
const cards = [];
for (const [id, { langs }] of byId) {
  const missing = LANGS.filter((l) => !langs[l]);
  if (missing.length) {
    errors.push(`${id}: no ${missing.join(', ')} card`);
    continue;
  }
  const [a, b] = LANGS.map((l) => langs[l]);
  for (const k of ['number', 'vital', 'health']) if (a[k] !== b[k]) errors.push(`${id}: ${k} differs between languages`);
  if ((a.see ?? []).join() !== (b.see ?? []).join()) errors.push(`${id}: see differs between languages`);
  const text = (c) => ({
    title: c.title,
    kind: c.kind,
    sources: c.sources,
    licence: c.licence,
    keywords: c.keywords,
    ...(c.translatedFrom ? { translatedFrom: c.translatedFrom } : {}),
    ...(c.basis ? { basis: c.basis } : {}),
    ...(c.note ? { note: c.note } : {}),
    body: c.body,
  });
  cards.push({
    id,
    number: a.number,
    section: Number(a.number.split('.')[0]),
    vital: a.vital,
    health: a.health,
    see: a.see ?? [],
    ...Object.fromEntries(LANGS.map((l) => [l, text(langs[l])])),
  });
}
for (const c of cards) for (const s of c.see) if (!byId.has(s)) errors.push(`${c.id}: related card "${s}" doesn't exist`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const out = JSON.stringify({ cards }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== out) {
    console.error('src/data/guide.json is stale: run node scripts/guide/build.mjs');
    process.exit(1);
  }
  console.log(`guide.json up to date (${cards.length} cards)`);
} else {
  fs.writeFileSync(outFile, out);
  console.log(`wrote src/data/guide.json: ${cards.length} cards, ${(out.length / 1024).toFixed(0)} KB`);
}
