import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMetalinkIntegrity, parseMetalinkUrls } from './mirrors.ts';

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

// Trimmed from https://download.kiwix.org/zim/devdocs/devdocs_en_bash_2026-10.zim.meta4
const META4 = `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <generator>MirrorBrain/2.19.0</generator>
  <file name="devdocs_en_bash_2026-10.zim">
    <size>572117</size>

    <!-- <mtime>1791195689</mtime> -->
    <!-- <size>1</size> -->
    <hash type="md5">16955e8143f5972926ac4460f927ba86</hash>
    <hash type="sha-1">1e9361e0816b853e3e30b79a3324dfadb3349a1e</hash>
    <hash type="sha-256">EA4AFB04DDF90F31363829EF9FA2485405DC05BD1FC62B4626245FE70C24735D</hash>
    <pieces length="4194304" type="sha-1">
      <hash>1e9361e0816b853e3e30b79a3324dfadb3349a1e</hash>
    </pieces>
    <url location="fr" priority="1">https://mirror.download.kiwix.org/zim/devdocs/devdocs_en_bash_2026-10.zim</url>
  </file>
</metalink>`;

test('parseMetalinkIntegrity reads the size and the whole-file sha-256', () => {
  assert.deepEqual(parseMetalinkIntegrity(META4, 'devdocs_en_bash_2026-10.zim'), {
    size: 572117,
    sha256: 'ea4afb04ddf90f31363829ef9fa2485405dc05bd1fc62b4626245fe70c24735d',
  });
  // Another file's metalink, or none at all: nothing to check.
  assert.deepEqual(parseMetalinkIntegrity(META4, 'devdocs_en_bash_2026-09.zim'), {});
  assert.deepEqual(parseMetalinkIntegrity('<html>404</html>', 'w.zim'), {});
  assert.deepEqual(parseMetalinkIntegrity('<metalink><file name="w.zim"><size>12</size></file></metalink>', 'w.zim'), { size: 12 });
});
