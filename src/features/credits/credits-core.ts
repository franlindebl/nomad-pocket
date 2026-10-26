// Credits & licenses: the shape of src/data/licenses.json (written by scripts/licenses.mjs)
// and the pure helpers the screens use. No `@/` imports so node --test can load it.

export type CreditKind = 'app' | 'native' | 'data' | 'js';

export type Credit = {
  id: string;
  name: string;
  version?: string;
  license: string;
  copyright?: string[];
  url?: string | null;
  note?: string;
  platforms?: string[];
  /** Index into `texts`, or null when there is no text to reproduce (see `url`). */
  text: number | null;
  /** The package ships no licence file: `text` is the standard text for its SPDX id. */
  standard?: boolean;
};

export type CreditsData = {
  app: Credit;
  native: Credit[];
  data: Credit[];
  js: Credit[];
  texts: string[];
};

/** Route id of an entry: "<kind>:<id>" (the app itself is just "app"). */
export function creditKey(kind: CreditKind, id: string): string {
  return kind === 'app' ? 'app' : `${kind}:${id}`;
}

export function findCredit(data: CreditsData, key: string): Credit | undefined {
  if (key === 'app') return data.app;
  const sep = key.indexOf(':');
  if (sep < 0) return undefined;
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  const list = kind === 'native' ? data.native : kind === 'data' ? data.data : kind === 'js' ? data.js : undefined;
  return list?.find((c) => c.id === id);
}

const PLATFORM: Record<string, string> = { ios: 'iOS', android: 'Android' };

/** "1.2.3 · MIT · iOS · Android": version, licence and platforms, whichever the entry has. */
export function creditSubtitle(c: Credit): string {
  return [c.version, c.license, ...(c.platforms ?? []).map((p) => PLATFORM[p] ?? p)].filter(Boolean).join(' · ');
}

/** Case-insensitive match on name and licence; every word of the query must appear. */
export function filterCredits(list: Credit[], query: string): Credit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const hay = `${c.name} ${c.license}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const LIST_ITEM = /^(?:[-*•+]|\d+[.)]|\(?[a-z0-9]{1,3}\)|#+)\s/i;

/**
 * Re-wraps a paragraph hard-wrapped at ~80 columns so it flows at phone width: lines join with
 * a space, except before a list item or heading, which keeps its own line.
 */
export function reflow(paragraph: string): string {
  const lines = paragraph.split('\n').map((l) => l.trim());
  let out = lines[0] ?? '';
  for (const line of lines.slice(1)) {
    if (!line) continue;
    out += LIST_ITEM.test(line) ? `\n${line}` : ` ${line}`;
  }
  return out;
}

/**
 * Splits a licence text into blocks of whole, reflowed paragraphs of at most ~`max` characters. One
 * <Text> per block: a single node holding a 100 KB text (MapLibre's notices) lays out slowly.
 */
export function textBlocks(text: string, max = 4000): string[] {
  const blocks: string[] = [];
  let current = '';
  for (const para of text
    .split(/\n\s*\n/)
    .map(reflow)
    .filter(Boolean)) {
    if (current && current.length + para.length + 2 > max) {
      blocks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}
