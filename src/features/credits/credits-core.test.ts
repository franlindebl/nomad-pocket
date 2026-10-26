import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditKey, creditSubtitle, filterCredits, findCredit, reflow, textBlocks, type Credit, type CreditsData } from './credits-core.ts';

const c = (id: string, name: string, license = 'MIT'): Credit => ({ id, name, license, text: 0 });
const data: CreditsData = {
  app: c('nomad-pocket', 'Nomad Pocket', 'GPL-3.0-or-later'),
  native: [c('libzim', 'libzim', 'GPL-2.0-or-later')],
  data: [c('openstreetmap', 'OpenStreetMap', 'ODbL-1.0')],
  js: [c('react@19.3.0', 'react'), c('@scope/pkg@1.0.0', '@scope/pkg', 'ISC')],
  texts: ['text'],
};

test('creditKey and findCredit round-trip every kind', () => {
  assert.equal(findCredit(data, creditKey('app', 'nomad-pocket')), data.app);
  assert.equal(findCredit(data, creditKey('native', 'libzim')), data.native[0]);
  assert.equal(findCredit(data, creditKey('data', 'openstreetmap')), data.data[0]);
  // Scoped names hold a second "@" and ids a ":"-free version: split on the first ":" only.
  assert.equal(findCredit(data, creditKey('js', '@scope/pkg@1.0.0')), data.js[1]);
});

test('findCredit rejects unknown kinds and ids', () => {
  assert.equal(findCredit(data, 'js:nope@1'), undefined);
  assert.equal(findCredit(data, 'texts:0'), undefined);
  assert.equal(findCredit(data, 'libzim'), undefined);
});

test('filterCredits matches every word against name and licence', () => {
  assert.deepEqual(filterCredits(data.js, ''), data.js);
  assert.deepEqual(filterCredits(data.js, '  REACT '), [data.js[0]]);
  assert.deepEqual(filterCredits(data.js, 'isc'), [data.js[1]]);
  assert.deepEqual(filterCredits(data.js, 'scope mit'), []);
});

test('textBlocks keeps paragraphs whole and under the limit', () => {
  const text = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n\n');
  assert.deepEqual(textBlocks(text, 70), [`${'a'.repeat(30)}\n\n${'b'.repeat(30)}`, 'c'.repeat(30)]);
  assert.deepEqual(textBlocks('short'), ['short']);
  // A paragraph longer than the limit stays in one block rather than being cut.
  assert.deepEqual(textBlocks('x'.repeat(100), 10), ['x'.repeat(100)]);
});

test('creditSubtitle joins what the entry has', () => {
  assert.equal(creditSubtitle({ ...c('x', 'x'), version: '1.0', platforms: ['ios', 'android'] }), '1.0 · MIT · iOS · Android');
  assert.equal(creditSubtitle(c('osm', 'OpenStreetMap', 'ODbL-1.0')), 'ODbL-1.0');
});

test('reflow joins hard-wrapped lines but keeps list items and headings apart', () => {
  assert.equal(
    reflow('  The GNU General Public License is a free,\ncopyleft license for\n   software.'),
    'The GNU General Public License is a free, copyleft license for software.',
  );
  assert.equal(reflow('conditions:\n* first\n  continued\n2. second\n(a) third'), 'conditions:\n* first continued\n2. second\n(a) third');
  assert.equal(reflow('## Heading'), '## Heading');
});
