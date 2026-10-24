// Offline glyphs (Noto Sans SDF ranges) and sprites ship inside the app as one
// zip. On first use it is unpacked into Documents/map-assets/<version>/ and the
// style references the files with file:// URLs, so labels and icons render with
// no network at all.
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync } from 'fflate';

import { emptyGlyphRange, FONTSTACKS, glyphRanges } from './glyphs';

// Bump when the zip contents change so devices unpack the new set.
const VERSION = 'v4';

export type MapAssets = {
  /** Glyph URL template for the style. */
  glyphs: string;
  /** Sprite base URL for a flavor (MapLibre appends .json/.png and @2x). */
  sprite: (flavor: 'light' | 'dark') => string;
};

function assetsDir() {
  return new Directory(Paths.document, 'map-assets', VERSION);
}

function urls(dir: Directory): MapAssets {
  const base = dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`;
  return {
    glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
    sprite: (flavor) => `${base}sprites/${flavor}`,
  };
}

let pending: Promise<MapAssets> | null = null;

export function ensureMapAssets(): Promise<MapAssets> {
  if (!pending) {
    pending = unpack().catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

async function unpack(): Promise<MapAssets> {
  const dir = assetsDir();
  const marker = new File(dir, '.complete');
  if (marker.exists) return urls(dir);

  const asset = Asset.fromModule(require('../../../assets/maps/basemap-assets.zip'));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('map assets missing from bundle');
  const zipped = await new File(asset.localUri).bytes();
  const files = unzipSync(zipped);

  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('/')) continue;
    const parts = path.split('/');
    const name = parts.pop()!;
    const parent = new Directory(dir, ...parts);
    if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
    const f = new File(parent, name);
    f.create({ overwrite: true });
    f.writeSync(bytes);
  }
  // The zip ships the common ranges only: fill the rest with empty ones (see glyphs.ts).
  for (const stack of FONTSTACKS) {
    const fontDir = new Directory(dir, 'fonts', stack);
    if (!fontDir.exists) fontDir.create({ intermediates: true, idempotent: true });
    for (const range of glyphRanges()) {
      const f = new File(fontDir, `${range}.pbf`);
      if (f.exists) continue;
      f.create();
      f.writeSync(emptyGlyphRange(stack, range));
    }
  }
  marker.create({ overwrite: true });

  // Drop older unpacked versions.
  const root = new Directory(Paths.document, 'map-assets');
  for (const entry of root.list()) if (entry instanceof Directory && entry.name !== VERSION) entry.delete();
  return urls(dir);
}
