// Reads AEMET's "estado completo" bundle: a .tar.gz with one CAP file per warning (~115 KB, ~220 files). fflate
// ungzips it; the tar is read here because fflate has no tar reader and a ustar walk is a few lines: 512-byte
// headers, the size in octal, the body padded to 512. Only regular files are returned.
// Pure (no app imports) so node --test can load it.

import { gunzipSync, strFromU8 } from 'fflate';

export type TarEntry = { name: string; data: Uint8Array };

const BLOCK = 512;

function field(b: Uint8Array, at: number, len: number): string {
  let end = at;
  while (end < at + len && b[end] !== 0) end++;
  return strFromU8(b.subarray(at, end));
}

/** The regular files of a (ustar or old-style) tar. Stops at the end-of-archive zero block or a short read. */
export function untar(tar: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let at = 0;
  while (at + BLOCK <= tar.length) {
    if (tar[at] === 0) break;
    const name = field(tar, at, 100);
    const size = parseInt(field(tar, at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[at + 156]);
    const prefix = field(tar, at + 257, 6).startsWith('ustar') ? field(tar, at + 345, 155) : '';
    const body = at + BLOCK;
    if (!Number.isFinite(size) || size < 0 || body + size > tar.length) break;
    if (type === '0' || type === '\0') out.push({ name: prefix ? `${prefix}/${name}` : name, data: tar.subarray(body, body + size) });
    at = body + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

/** The text of every `.xml` file in a .tar.gz, in archive order. */
export function xmlFilesOfTarGz(gz: Uint8Array): { name: string; xml: string }[] {
  return untar(gunzipSync(gz))
    .filter((e) => e.name.toLowerCase().endsWith('.xml'))
    .map((e) => ({ name: e.name.slice(e.name.lastIndexOf('/') + 1), xml: strFromU8(e.data) }));
}
