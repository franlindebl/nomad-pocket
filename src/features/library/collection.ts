// Document collections built by Kiwix's nautilus scraper (the zimgit-* archives: medicine, water,
// knots…). Their main page is a desktop Bootstrap app around `database.js`, a JS file with one
// literal array of documents (Python repr: single quotes, \xNN escapes). The reader shows that
// list natively instead of the web page; this module reads it. Pure, no `@/` imports.

export type CollectionDoc = {
  id: string;
  title: string;
  author: string;
  description: string;
  /** Entry paths in the archive ("files/Water (3).pdf"), at least one. */
  files: string[];
};

export type FileKind = 'pdf' | 'video' | 'audio' | 'image' | 'other';

/** Where nautilus keeps the documents (its `files_prefix`). */
const FILES_PREFIX = 'files/';

/** Documents of a nautilus `database.js`, or null when the text isn't one. */
export function parseCollection(js: string): CollectionDoc[] | null {
  const start = /\bDATABASE\s*=\s*\[/.exec(js);
  if (!start) return null;
  let raw: unknown;
  try {
    raw = new LiteralParser(js, start.index + start[0].length - 1).value();
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const docs: CollectionDoc[] = [];
  for (const [i, d] of raw.entries()) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const r = d as Record<string, unknown>;
    const files = (Array.isArray(r.fp) ? r.fp : []).filter((f): f is string => typeof f === 'string' && !!f).map((f) => FILES_PREFIX + f);
    const title = str(r.ti) || files[0]?.slice(FILES_PREFIX.length) || '';
    if (!files.length || !title) continue;
    // nautilus' own popup reads `desc`, its list `dsc`: accept both.
    docs.push({ id: str(r._id) || String(i), title, author: str(r.aut), description: str(r.dsc) || str(r.desc), files });
  }
  return docs.length ? docs : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Documents whose title, author or description contain every word of the query (accents ignored). */
export function filterCollection(docs: CollectionDoc[], query: string): CollectionDoc[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return docs;
  return docs.filter((d) => {
    const hay = fold(`${d.title} ${d.author} ${d.description}`);
    return words.every((w) => hay.includes(w));
  });
}

export function fileKind(path: string): FileKind {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav', 'aac', 'flac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

/** File name of an entry path, for multi-file documents ("files/Water (3).pdf" → "Water (3).pdf"). */
export function fileLabel(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Minimal reader for JS / Python literals: arrays, objects, strings, numbers, booleans, null. */
class LiteralParser {
  private readonly s: string;
  private i: number;

  constructor(s: string, start: number) {
    this.s = s;
    this.i = start;
  }

  value(): unknown {
    this.ws();
    const c = this.s[this.i];
    if (c === '[') return this.list();
    if (c === '{') return this.object();
    if (c === "'" || c === '"') return this.string();
    const word = /^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null|True|False|None|undefined)/i.exec(this.s.slice(this.i, this.i + 32));
    if (!word) throw new Error(`unexpected ${c} at ${this.i}`);
    this.i += word[0].length;
    const w = word[0];
    if (w === 'true' || w === 'True') return true;
    if (w === 'false' || w === 'False') return false;
    if (w === 'null' || w === 'None' || w === 'undefined') return null;
    return Number(w);
  }

  private list(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    for (;;) {
      this.ws();
      if (this.s[this.i] === ']') {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.separator(']');
    }
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    for (;;) {
      this.ws();
      if (this.s[this.i] === '}') {
        this.i++;
        return out;
      }
      const c = this.s[this.i];
      let key: string;
      if (c === "'" || c === '"') key = this.string();
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
        if (!m) throw new Error(`bad key at ${this.i}`);
        key = m[0];
        this.i += key.length;
      }
      this.ws();
      if (this.s[this.i++] !== ':') throw new Error(`expected : at ${this.i}`);
      out[key] = this.value();
      this.separator('}');
    }
  }

  /** After an element: a comma (trailing commas allowed) or the closing bracket, left in place. */
  private separator(close: string) {
    this.ws();
    const c = this.s[this.i];
    if (c === ',') this.i++;
    else if (c !== close) throw new Error(`expected , or ${close} at ${this.i}`);
  }

  private string(): string {
    const quote = this.s[this.i++];
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) throw new Error('unterminated string');
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      switch (e) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case 'b':
        case 'f':
          out += ' ';
          break;
        case 'x':
          out += String.fromCharCode(parseInt(this.hex(2), 16));
          break;
        case 'u':
          out += String.fromCharCode(parseInt(this.hex(4), 16));
          break;
        case 'U':
          out += String.fromCodePoint(parseInt(this.hex(8), 16));
          break;
        case '\n':
          break;
        default:
          out += e;
      }
    }
  }

  private hex(n: number): string {
    const h = this.s.slice(this.i, this.i + n);
    if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(h)) throw new Error(`bad escape at ${this.i}`);
    this.i += n;
    return h;
  }

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
}
