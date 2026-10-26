/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmptyExtractError, planExtract } from './extract.ts';
import { Compression, FormatError, HEADER_SIZE, MAX_LEAF_DEPTH, TileType, concatBytes, serializeDirectory, serializeHeader, type Entry } from './format.ts';
import { BytesSource } from './io.ts';
import { listZoomTiles } from './reader.ts';

const LEAF = 5; // bytes of a one-entry directory with small numbers

/**
 * A corrupt archive whose leaf directories form a chain: leaf k points at leaf next(k), and
 * a leaf with no next holds the one tile. `next(k) === k` is a leaf pointing at itself.
 */
function craftedArchive(levels: number, next: (k: number) => number | null): Uint8Array {
  const leafEntry = (k: number): Entry => ({ tileId: 0, offset: k * LEAF, length: LEAF, runLength: 0 });
  const root = serializeDirectory([leafEntry(0)]);
  const leaves: Uint8Array[] = [];
  for (let k = 0; k < levels; k++) {
    const n = next(k);
    const dir = serializeDirectory([n === null ? { tileId: 0, offset: 0, length: 1, runLength: 1 } : leafEntry(n)]);
    assert.equal(dir.length, LEAF);
    leaves.push(dir);
  }
  const leafBytes = concatBytes(leaves);
  const tile = new Uint8Array([7]);
  const header = serializeHeader({
    specVersion: 3,
    rootDirectoryOffset: HEADER_SIZE,
    rootDirectoryLength: root.length,
    jsonMetadataOffset: HEADER_SIZE + root.length,
    jsonMetadataLength: 0,
    leafDirectoryOffset: HEADER_SIZE + root.length,
    leafDirectoryLength: leafBytes.length,
    tileDataOffset: HEADER_SIZE + root.length + leafBytes.length,
    tileDataLength: tile.length,
    numAddressedTiles: 1,
    numTileEntries: 1,
    numTileContents: 1,
    clustered: true,
    internalCompression: Compression.None,
    tileCompression: Compression.None,
    tileType: TileType.Mvt,
    minZoom: 0,
    maxZoom: 0,
    minLon: -180,
    minLat: -85,
    maxLon: 180,
    maxLat: 85,
    centerZoom: 0,
    centerLon: 0,
    centerLat: 0,
  });
  // Readers fetch the first 16 KiB in one go.
  const bytes = concatBytes([header, root, leafBytes, tile]);
  return concatBytes([bytes, new Uint8Array(Math.max(0, 16384 - bytes.length))]);
}

const WORLD = { bbox: [-180, -85, 180, 85] as [number, number, number, number], minZoom: 0, maxZoom: 0 };

test('a well-formed chain of leaves within the depth limit is read', async () => {
  const data = craftedArchive(MAX_LEAF_DEPTH, (k) => (k + 1 < MAX_LEAF_DEPTH ? k + 1 : null));
  const { tiles } = await listZoomTiles(new BytesSource(data), 0);
  assert.equal(tiles.length, 1);
  const plan = await planExtract(new BytesSource(data), WORLD);
  assert.ok(plan);
});

test('a leaf pointing at itself ends instead of recursing forever', async () => {
  const data = craftedArchive(1, () => 0);
  const { tiles } = await listZoomTiles(new BytesSource(data), 0);
  assert.equal(tiles.length, 0);
  await assert.rejects(planExtract(new BytesSource(data), WORLD), EmptyExtractError);
});

test('leaves nested deeper than the limit are rejected', async () => {
  const data = craftedArchive(MAX_LEAF_DEPTH + 2, (k) => (k + 1 < MAX_LEAF_DEPTH + 2 ? k + 1 : null));
  await assert.rejects(listZoomTiles(new BytesSource(data), 0), FormatError);
  await assert.rejects(planExtract(new BytesSource(data), WORLD), FormatError);
});
