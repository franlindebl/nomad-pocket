/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ByteReader,
  ByteWriter,
  Compression,
  FormatError,
  HEADER_SIZE,
  TileType,
  buildDirectories,
  decompress,
  deserializeDirectory,
  parseHeader,
  serializeDirectory,
  serializeHeader,
  type Entry,
  type Header,
} from './format.ts';

test('varints round-trip up to 2^53', () => {
  const values = [0, 1, 127, 128, 255, 300, 16383, 16384, 2 ** 31, 2 ** 32 + 5, 2 ** 40 - 1, Number.MAX_SAFE_INTEGER];
  const w = new ByteWriter(4);
  for (const v of values) w.varint(v);
  const r = new ByteReader(w.bytes());
  for (const v of values) assert.equal(r.varint(), v);
  assert.throws(() => w.varint(-1));
});

test('header round-trip', () => {
  const h: Header = {
    specVersion: 3,
    rootDirectoryOffset: 127,
    rootDirectoryLength: 1000,
    jsonMetadataOffset: 1127,
    jsonMetadataLength: 300,
    leafDirectoryOffset: 1427,
    leafDirectoryLength: 2 ** 33 + 17,
    tileDataOffset: 2 ** 34,
    tileDataLength: 139013292063,
    numAddressedTiles: 2 ** 36,
    numTileEntries: 12345,
    numTileContents: 999,
    clustered: true,
    internalCompression: Compression.Gzip,
    tileCompression: Compression.Gzip,
    tileType: TileType.Mvt,
    minZoom: 0,
    maxZoom: 15,
    minLon: -180,
    minLat: -85.0511287,
    maxLon: 180,
    maxLat: 85.0511287,
    centerZoom: 3,
    centerLon: -3.7037902,
    centerLat: 40.4167754,
  };
  const bytes = serializeHeader(h);
  assert.equal(bytes.length, HEADER_SIZE);
  assert.deepEqual(parseHeader(bytes), h);
  const bad = bytes.slice();
  bad[0] = 0;
  assert.throws(() => parseHeader(bad));
});

function sampleEntries(n: number): Entry[] {
  const out: Entry[] = [];
  let id = 0;
  let offset = 0;
  for (let i = 0; i < n; i++) {
    id += 1 + (i % 7 === 0 ? 1000 : 0);
    const length = 100 + ((i * 7919) % 5000);
    const dup = i % 11 === 5 && out.length > 3;
    const runLength = i % 13 === 0 ? 1 + (i % 50) : 1;
    out.push({ tileId: id, offset: dup ? out[out.length - 3].offset : offset, length: dup ? out[out.length - 3].length : length, runLength });
    if (!dup) offset += length;
    id += runLength - 1;
  }
  return out;
}

test('directory serialization round-trip (incl. offset elision and leaves)', () => {
  const entries = sampleEntries(5000);
  entries.push({ tileId: 2 ** 40, offset: 2 ** 37, length: 10, runLength: 0 });
  assert.deepEqual(deserializeDirectory(serializeDirectory(entries)), entries);
  assert.deepEqual(deserializeDirectory(serializeDirectory([])), []);
  // A corrupt entry count is refused before it allocates anything.
  const w = new ByteWriter(8);
  w.varint(1e9);
  assert.throws(() => deserializeDirectory(w.bytes()), FormatError);
  assert.throws(() => serializeDirectory([entries[1], entries[0]]));
});

test('buildDirectories splits into leaves and the root fits in 16 KiB', () => {
  for (const [count, leafSize] of [
    [100, undefined],
    [200_000, undefined],
    [300, 32],
  ] as const) {
    const entries = sampleEntries(count);
    const { root, leaves, numLeaves } = buildDirectories(entries, Compression.Gzip, { leafSize });
    assert.ok(root.length <= 16384 - HEADER_SIZE);
    const rootEntries = deserializeDirectory(decompress(root, Compression.Gzip));
    if (!numLeaves) {
      assert.deepEqual(rootEntries, entries);
      continue;
    }
    const all: Entry[] = [];
    for (const r of rootEntries) {
      assert.equal(r.runLength, 0);
      all.push(...deserializeDirectory(decompress(leaves.subarray(r.offset, r.offset + r.length), Compression.Gzip)));
    }
    assert.deepEqual(all, entries);
  }
});
