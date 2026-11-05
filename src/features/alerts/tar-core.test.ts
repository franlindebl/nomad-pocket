import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { gzipSync, strToU8 } from 'fflate';

import { untar, xmlFilesOfTarGz } from './tar-core.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** One ustar header + body, padded to 512-byte blocks. */
function entry(name: string, body: string, type = '0', prefix = ''): Uint8Array {
  const data = strToU8(body);
  const h = new Uint8Array(512);
  h.set(strToU8(name), 0);
  h.set(strToU8(data.length.toString(8).padStart(11, '0') + '\0'), 124);
  h[156] = type.charCodeAt(0);
  h.set(strToU8('ustar\0' + '00'), 257);
  h.set(strToU8(prefix), 345);
  const out = new Uint8Array(512 + Math.ceil(data.length / 512) * 512);
  out.set(h, 0);
  out.set(data, 512);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

test('untar reads regular files, skips directories and joins a ustar prefix', () => {
  const tar = concat(
    entry('dir/', '', '5'),
    entry('a.xml', '<a/>'),
    entry('b.txt', 'x'.repeat(600), '0', 'deep/path'),
    new Uint8Array(1024),
  );
  const files = untar(tar);
  assert.deepEqual(
    files.map((f) => [f.name, f.data.length]),
    [
      ['a.xml', 4],
      ['deep/path/b.txt', 600],
    ],
  );
});

test('untar stops at a truncated body instead of reading past the end', () => {
  const tar = entry('a.xml', 'x'.repeat(1000));
  assert.equal(untar(tar.subarray(0, 900)).length, 0);
});

test("xmlFilesOfTarGz opens AEMET's bundle: every CAP file in force", () => {
  const files = xmlFilesOfTarGz(fixture('aemet-afae.tar.gz'));
  assert.equal(files.length, 219);
  assert.ok(files.every((f) => /^Z_CAP_C_LEMM_\d{14}_AFAZ\w+\.xml$/.test(f.name)));
  assert.ok(files.every((f) => f.xml.startsWith('<?xml') && f.xml.includes('urn:oasis:names:tc:emergency:cap:1.2')));
  assert.ok(
    files.some((f) => f.xml.includes('Valle del Guadalentín')),
    'UTF-8 decoded',
  );
});

test('xmlFilesOfTarGz ignores files that are not XML', () => {
  const gz = gzipSync(concat(entry('readme.txt', 'hi'), entry('x/one.XML', '<alert/>'), new Uint8Array(1024)));
  assert.deepEqual(xmlFilesOfTarGz(gz), [{ name: 'one.XML', xml: '<alert/>' }]);
});
