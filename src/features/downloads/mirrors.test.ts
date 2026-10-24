import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMetalinkUrls } from './mirrors.ts';

test('parseMetalinkUrls keeps https mirrors of the file, by priority', () => {
  const xml = `<metalink><file name="w.zim">
    <url>https://kiwix.org</url>
    <url location="dk" priority="3">https://mirrors.dotsrc.org/kiwix/zim/w.zim</url>
    <url location="fr" priority="1">https://mirror.download.kiwix.org/zim/w.zim</url>
    <url location="xx" priority="2">http://insecure.example/zim/w.zim</url>
    <url location="nl" priority="2">https://ftp.nluug.nl/pub/kiwix/zim/w.zim</url>
  </file></metalink>`;
  assert.deepEqual(parseMetalinkUrls(xml, 'w.zim'), [
    'https://mirror.download.kiwix.org/zim/w.zim',
    'https://ftp.nluug.nl/pub/kiwix/zim/w.zim',
    'https://mirrors.dotsrc.org/kiwix/zim/w.zim',
  ]);
});
