import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackZimId, isNewerVersion, retargetSources, zimFileStem, zimRegistrationId } from './register-core.ts';

const DIR = 'file:///var/mobile/Containers/Data/Application/A/Documents/content/zim';

test('zimFileStem drops the extension, the Kiwix date and an import suffix', () => {
  assert.equal(zimFileStem(`${DIR}/wikipedia_fr_all_nopic_2026-09.zim`), 'wikipedia_fr_all_nopic');
  assert.equal(zimFileStem(`${DIR}/wikipedia_es_medicine_nopic_2026-10b.zim`), 'wikipedia_es_medicine_nopic');
  assert.equal(zimFileStem(`${DIR}/wikipedia_fr_all_nopic_2026-09-1.zim`), 'wikipedia_fr_all_nopic');
  assert.equal(zimFileStem(`${DIR}/caf%C3%A9_2026-09.zim`), 'café');
  assert.equal(zimFileStem(`${DIR}/my book.ZIM`), 'my book');
  assert.equal(zimFileStem(`${DIR}/release-2026.zim`), 'release-2026');
});

test('fallbackZimId keeps the flavour that the ZIM Name leaves out', () => {
  const uuid = '1234abcd-0000-0000-0000-000000000000';
  assert.equal(fallbackZimId('wikipedia_fr_all', uuid, `${DIR}/wikipedia_fr_all_nopic_2026-09.zim`), 'wikipedia_fr_all_nopic');
  assert.equal(fallbackZimId('wikipedia_fr_all', uuid, `${DIR}/wikipedia_fr_all_maxi_2026-09.zim`), 'wikipedia_fr_all_maxi');
  assert.equal(fallbackZimId('wikem_en_all', uuid, `${DIR}/wikem_en_all_2026-09.zim`), 'wikem_en_all');
  // Renamed file: the name is all there is.
  assert.equal(fallbackZimId('wikipedia_fr_all', uuid, `${DIR}/french wiki.zim`), 'wikipedia_fr_all');
  // "wikipedia_fr_allx" is not wikipedia_fr_all with a flavour.
  assert.equal(fallbackZimId('wikipedia_fr_all', uuid, `${DIR}/wikipedia_fr_allx_2026-09.zim`), 'wikipedia_fr_all');
  assert.equal(fallbackZimId(null, uuid, `${DIR}/x.zim`), uuid);
});

test('isNewerVersion compares dates; unknown is never newer', () => {
  assert.equal(isNewerVersion('2026-10', '2026-09'), true);
  assert.equal(isNewerVersion('2026-09', '2026-09'), false);
  assert.equal(isNewerVersion('2026-06', '2026-09'), false);
  assert.equal(isNewerVersion('2026-09', null), true);
  assert.equal(isNewerVersion(null, '2026-09'), false);
  assert.equal(isNewerVersion(null, null), false);
});

test('zimRegistrationId: updates replace, other books and older editions get their own id', () => {
  const installed = { fileUri: `${DIR}/a_2026-09.zim`, uuid: 'aaaa', version: '2026-09', fileExists: true };
  const next = { fileUri: `${DIR}/a_2026-10.zim`, uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', version: '2026-10', requested: false };
  // Nothing installed under that id, or the same file again.
  assert.equal(zimRegistrationId('a', next, null), 'a');
  assert.equal(zimRegistrationId('a', next, { ...installed, fileUri: next.fileUri }), 'a');
  // Newer edition, a download the person started, the same archive, or a row whose file is gone.
  assert.equal(zimRegistrationId('a', next, installed), 'a');
  assert.equal(zimRegistrationId('a', { ...next, version: '2026-01', requested: true }, installed), 'a');
  assert.equal(zimRegistrationId('a', { ...next, version: '2026-09', uuid: 'aaaa' }, installed), 'a');
  assert.equal(zimRegistrationId('a', { ...next, version: '2026-01' }, { ...installed, fileExists: false }), 'a');
  // Older or same-month edition of another build: kept next to it.
  assert.equal(zimRegistrationId('a', { ...next, version: '2026-01' }, installed), 'a_bbbbbbbb');
  assert.equal(zimRegistrationId('a', { ...next, version: '2026-09' }, installed), 'a_bbbbbbbb');
  assert.equal(zimRegistrationId('a', { ...next, version: null }, installed), 'a_bbbbbbbb');
});

test('retargetSources moves citations to the new id and leaves the rest', () => {
  const json = JSON.stringify([
    { n: 1, itemId: 'old', path: 'A/a', title: 'A' },
    { n: 2, itemId: 'other', path: 'B/b', title: 'B' },
  ]);
  assert.deepEqual(JSON.parse(retargetSources(json, 'old', 'new')!), [
    { n: 1, itemId: 'new', path: 'A/a', title: 'A' },
    { n: 2, itemId: 'other', path: 'B/b', title: 'B' },
  ]);
  assert.equal(retargetSources(json, 'missing', 'new'), null);
  assert.equal(retargetSources(null, 'old', 'new'), null);
  assert.equal(retargetSources('not json', 'old', 'new'), null);
  assert.equal(retargetSources('{"itemId":"old"}', 'old', 'new'), null);
});
