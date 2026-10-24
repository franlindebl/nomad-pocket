// Placeholder glyph ranges for the offline map fonts. Pure so `node --test` can load it.

/** Font stacks the Protomaps style asks for (@protomaps/basemaps layers). */
export const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic', 'Noto Sans Devanagari Regular v1'];

/** Every 256-code-point range MapLibre can request: "0-255" … "65280-65535". */
export function glyphRanges(): string[] {
  const out: string[] = [];
  for (let start = 0; start < 65536; start += 256) out.push(`${start}-${start + 255}`);
  return out;
}

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n >>>= 7;
  } while (n);
  return out;
}

function field(tag: number, bytes: Uint8Array): number[] {
  return [(tag << 3) | 2, ...varint(bytes.length), ...bytes];
}

/**
 * A valid glyph PBF with no glyphs (`glyphs { stacks { name, range } }`). MapLibre Native
 * does not draw a tile while a glyph range it needs fails to load, so a missing range
 * (Arabic names around Melilla, any script we don't ship) blanked whole map areas.
 * With this placeholder those characters are simply not drawn.
 */
export function emptyGlyphRange(fontstack: string, range: string): Uint8Array {
  const enc = new TextEncoder();
  const stack = [...field(1, enc.encode(fontstack)), ...field(2, enc.encode(range))];
  return new Uint8Array(field(1, new Uint8Array(stack)));
}
