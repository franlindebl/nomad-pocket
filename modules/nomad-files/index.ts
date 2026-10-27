// JS API of the streaming file helpers (sha-256 of a whole file, copying a file into another
// at an offset). Native on iOS and Android: multi-GB files never pass through JS, and memory
// stays at one block (see ios/NomadFilesModule.swift for the expo-file-system bug it avoids).
import { requireNativeModule } from 'expo-modules-core';

type NomadFilesNative = {
  sha256(path: string): Promise<string>;
  copyInto(src: string, dst: string, offset: number, pieceLength: number, sha1s: string[]): Promise<number>;
};

const NomadFiles = requireNativeModule<NomadFilesNative>('NomadFiles');

/** Lowercase hex sha-256 of a whole file (`path`: a plain path or a file:// URI). */
export function sha256(path: string): Promise<string> {
  return NomadFiles.sha256(path);
}

/**
 * Writes all of `src` into `dst` at byte `offset` (creating `dst`, never truncating it).
 * `pieces`: `src` is made of `length`-byte pieces with these sha-1 hashes, each checked before it
 * is written. Resolves with the bytes written, or `{ badPiece }` (index within `pieces.sha1`) when
 * one doesn't match: nothing from it on is written.
 */
export async function copyInto(src: string, dst: string, offset: number): Promise<number>;
export async function copyInto(
  src: string,
  dst: string,
  offset: number,
  pieces: { length: number; sha1: string[] } | undefined,
): Promise<number | { badPiece: number }>;
export async function copyInto(
  src: string,
  dst: string,
  offset: number,
  pieces?: { length: number; sha1: string[] },
): Promise<number | { badPiece: number }> {
  const r = await NomadFiles.copyInto(src, dst, offset, pieces?.length ?? 0, pieces?.sha1 ?? []);
  return r < 0 ? { badPiece: -r - 1 } : r;
}
