/// <reference types="node" />
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { INDEX_MIGRATIONS } from '../../db/schema.ts';

import {
  cleanPageText,
  deleteArchive,
  docMatch,
  documentPassages,
  documentTitle,
  fusePassages,
  hasText,
  insertDocument,
  looksLikeTitle,
  searchPassages,
  splitPassages,
  type AsyncSql,
  type DocHit,
  type Params,
} from './documents-core.ts';

function open(): { d: DatabaseSync; sql: AsyncSql } {
  const d = new DatabaseSync(':memory:');
  for (const m of INDEX_MIGRATIONS) d.exec(m);
  const sql: AsyncSql = {
    run: async (s, p = {}) => d.prepare(s).run(p),
    all: async <T>(s: string, p: Params = {}) => d.prepare(s).all(p) as T[],
  };
  return { d, sql };
}

test('cleanPageText joins hyphenated words and unwraps lines, keeping paragraphs', () => {
  const raw = 'Boil the water for at least one min-\nute. Let it cool\nbefore drinking.\n\nStore it in clean\r\ncontainers.';
  assert.equal(cleanPageText(raw), 'Boil the water for at least one minute. Let it cool before drinking.\n\nStore it in clean containers.');
  // A capital after the hyphen is a real compound ("Anti-\nInflammatory" stays hyphenated, joined by a space).
  assert.equal(cleanPageText('Non-\nSteroidal'), 'Non- Steroidal');
});

test('hasText tells a text layer from a scan', () => {
  assert.equal(hasText(''), false);
  assert.equal(hasText(' \n 12 \n'), false);
  assert.equal(hasText('Apply direct pressure to the wound with a clean cloth until the bleeding stops.'), true);
});

test('splitPassages keeps sentences whole and passages near the size', () => {
  const sentence = 'Apply firm pressure on the wound for ten minutes without lifting the cloth. ';
  const text = sentence.repeat(30).trim();
  const out = splitPassages(text, 300, 80);
  assert.ok(out.length > 5);
  for (const p of out) {
    assert.ok(p.length <= 300, p);
    assert.ok(p.endsWith('cloth.'), p);
  }
  assert.deepEqual(splitPassages('Short.', 300), ['Short.']);
  // A run-on without sentence ends is cut by size.
  assert.ok(splitPassages('x'.repeat(1000), 300, 50).every((p) => p.length <= 300));
});

test('documentPassages numbers pages from 1, skips scans and tables of contents', () => {
  const prose = 'Purify water by boiling it for one minute, or three minutes above 2,000 metres. '.repeat(3);
  const toc = 'Chapter 1 ........ 1\nChapter 2 ........ 15\nChapter 3 ........ 27\n'.repeat(3);
  const { rows, textPages } = documentPassages(['', prose, toc, ' 3 ']);
  assert.equal(textPages, 2);
  assert.deepEqual(
    rows.map((r) => r.page),
    [2],
  );
});

test('looksLikeTitle rejects file names and scanner codes', () => {
  for (const bad of ['42511cvr', 'Microsoft Word - 429AE2A1-2035-203AED.doc', 'untitled', '', null, 'ab']) assert.equal(looksLikeTitle(bad), false, String(bad));
  for (const good of ['Wound Closure Manual', 'HHS Pandemic Influenza Plan', 'Hospital Corpsman (part 1 of 3)']) assert.equal(looksLikeTitle(good), true, good);
});

test('documentTitle: collection, then a telling link text, then the PDF title, then the file', () => {
  assert.equal(documentTitle('files/Water (3).pdf', { collection: 'Emergency Water Treatment', pdf: 'x' }), 'Emergency Water Treatment');
  assert.equal(documentTitle('milmed/first.pdf', { link: 'First Aid', pdf: 'FM 4-25.11' }), 'First Aid');
  assert.equal(documentTitle('milmed/corpsman-pt1.pdf', { link: 'Part 1', pdf: 'Hospital Corpsman (part 1 of 3)' }), 'Hospital Corpsman (part 1 of 3)');
  assert.equal(documentTitle('milmed/x.pdf', { link: 'Part 2', pdf: '42511cvr' }), 'Part 2');
  assert.equal(documentTitle('milmed/sfhandbook-pt2.pdf', {}), 'sfhandbook pt2');
  assert.equal(documentTitle('files/x.pdf', { collection: 'Student_manual_2005' }), 'Student manual 2005');
  assert.equal(documentTitle('files/x.pdf', { collection: 'the-ten-bushcraft-books' }), 'the ten bushcraft books');
  assert.equal(documentTitle('files/x.pdf', { collection: 'ENEWER US ARMY FM-21-76-Survival-2002' }), 'ENEWER US ARMY FM-21-76-Survival-2002');
});

test('docMatch quotes every word so FTS syntax never gets through', () => {
  assert.equal(docMatch('treat a "burn" OR NEAR(x*)'), '"treat" "burn" "or" "near"');
  assert.equal(docMatch('¿?'), null);
  assert.equal(docMatch('vitamin c'), '"vitamin"');
  assert.equal(docMatch('type 2 diabetes'), '"type" "2" "diabetes"');
  assert.equal(docMatch('heavy bleeding heavy wound', 'any'), '"heavy" OR "bleeding" OR "wound"');
});

test('insert, search with stemming, filter by archive, delete', async () => {
  const { d, sql } = open();
  await insertDocument(sql, {
    itemId: 'zimgit-water_en',
    path: 'files/Water (3).pdf',
    title: 'Emergency Water Treatment',
    pages: 3,
    textPages: 2,
    status: 'done',
    rows: [
      { page: 1, text: 'Boiling water for one minute kills bacteria, viruses and parasites.' },
      { page: 2, text: 'Store treated water in clean, covered containers away from sunlight.' },
    ],
  });
  await insertDocument(sql, {
    itemId: 'irp.fas.org_en_military-medicine',
    path: 'milmed/first.pdf',
    title: 'First Aid',
    pages: 1,
    textPages: 1,
    status: 'done',
    rows: [{ page: 1, text: 'Apply a tourniquet above the wound when direct pressure does not stop the bleeding.' }],
  });
  // Porter stemming: "boil" finds "Boiling".
  const hits = await searchPassages(sql, 'boil water', ['zimgit-water_en', 'irp.fas.org_en_military-medicine'], 5);
  assert.deepEqual(
    hits.map((h) => [h.title, h.page]),
    [['Emergency Water Treatment', 1]],
  );
  assert.equal((await searchPassages(sql, 'tourniquet', ['zimgit-water_en'], 5)).length, 0);
  assert.equal((await searchPassages(sql, 'tourniquets', ['irp.fas.org_en_military-medicine'], 5)).length, 1);
  const files = d.prepare('SELECT path, passages, status FROM doc_files ORDER BY path').all();
  assert.equal(files.length, 2);

  await deleteArchive(sql, 'zimgit-water_en');
  assert.equal((d.prepare('SELECT count(*) AS n FROM doc_passages').get() as { n: number }).n, 1);
  assert.equal((d.prepare('SELECT count(*) AS n FROM doc_files').get() as { n: number }).n, 1);
});

test('insertDocument writes nothing when it fails half way', async () => {
  const { d, sql } = open();
  const failing: AsyncSql = {
    run: async (s, p) => {
      if (s.includes('doc_files')) throw new Error('disk full');
      return sql.run(s, p);
    },
    all: sql.all,
  };
  await assert.rejects(
    insertDocument(failing, { itemId: 'a', path: 'p.pdf', title: 'T', pages: 1, textPages: 1, status: 'done', rows: [{ page: 1, text: 'Some words here.' }] }),
  );
  assert.equal((d.prepare('SELECT count(*) AS n FROM doc_passages').get() as { n: number }).n, 0);
});

test('fusePassages ranks hits found by several queries first and drops twins', () => {
  const hit = (id: number, text: string): DocHit => ({ id, itemId: 'a', path: 'p', page: 1, title: 'T', text });
  const out = fusePassages(
    [
      [hit(1, 'one'), hit(2, 'two')],
      [hit(3, 'three'), hit(2, 'two'), hit(4, 'one')],
    ],
    10,
  );
  assert.deepEqual(
    out.map((h) => h.id),
    [2, 1, 3],
  );
});
