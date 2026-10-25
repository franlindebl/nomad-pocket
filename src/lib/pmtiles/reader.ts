// Sequential reads from a local archive: list every tile of one zoom level and
// read tile payloads. Used to build the offline place index from installed maps
// (the extractor only copies tiles; this reads what is inside them).
import { decompress, deserializeDirectory, type Header } from './format.ts';
import { throwIfAborted, type RangeSource } from './io.ts';
import { tileIdToZxy, zoomBase } from './tileid.ts';
import { readArchiveInfo } from './extract.ts';

export type TileEntry = {
  tileId: number;
  z: number;
  x: number;
  y: number;
  /** Absolute offset of the (compressed) payload in the archive. */
  offset: number;
  length: number;
};

/**
 * Tile entries of zoom `z`, in tile-id order. Run-length entries (repeated
 * content, i.e. empty ocean or land tiles) yield only their first tile: indexing
 * the same payload twice would only add duplicates.
 */
export async function listZoomTiles(source: RangeSource, z: number, signal?: AbortSignal): Promise<{ header: Header; tiles: TileEntry[] }> {
  const info = await readArchiveInfo(source, signal);
  const header = info.header;
  const lo = zoomBase(z);
  const hi = zoomBase(z + 1);
  const tiles: TileEntry[] = [];
  const seenOffsets = new Set<number>();

  const walk = async (entries: ReturnType<typeof deserializeDirectory>, endBound: number) => {
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      const end = en.runLength > 0 ? en.tileId + en.runLength : i + 1 < entries.length ? entries[i + 1].tileId : endBound;
      if (end <= lo || en.tileId >= hi) continue;
      if (en.runLength > 0) {
        if (en.tileId < lo || seenOffsets.has(en.offset)) continue;
        seenOffsets.add(en.offset);
        const [tz, x, y] = tileIdToZxy(en.tileId);
        tiles.push({ tileId: en.tileId, z: tz, x, y, offset: header.tileDataOffset + en.offset, length: en.length });
      } else {
        throwIfAborted(signal);
        const raw = await source.getBytes(header.leafDirectoryOffset + en.offset, en.length, signal);
        await walk(deserializeDirectory(decompress(raw, header.internalCompression)), end);
      }
    }
  };
  await walk(info.rootEntries, Infinity);
  return { header, tiles };
}

/** Reads and decompresses one tile payload. */
export async function readTile(source: RangeSource, header: Header, tile: TileEntry, signal?: AbortSignal): Promise<Uint8Array> {
  const raw = await source.getBytes(tile.offset, tile.length, signal);
  return decompress(raw, header.tileCompression);
}
