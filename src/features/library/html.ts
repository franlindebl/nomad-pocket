// Small, dependency-free HTML helpers for ZIM articles (no DOM in React Native).
// A tolerant tokenizer walks the document once: it drops scripts, styles,
// navigation and Wikipedia/mwoffliner chrome, and keeps paragraph structure.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', bull: '•', middot: '·', deg: '°', copy: '©', reg: '®', trade: '™', times: '×',
  divide: '÷', plusmn: '±', minus: '−', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', auml: 'ä', ouml: 'ö', szlig: 'ß',
  shy: '', zwj: '', zwnj: '', lrm: '', rlm: '', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
};

export function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

/** Removes tags (e.g. Xapian's <b> highlights) and decodes entities. */
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// Elements whose whole subtree is dropped.
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside', 'svg', 'math',
  'button', 'select', 'textarea', 'form', 'iframe', 'object', 'video', 'audio', 'canvas', 'head', 'title',
]);
// Class/id fragments of chrome to drop (Wikipedia, mwoffliner, StackExchange, Gutenberg…).
const SKIP_CLASS = /(?:^|\s)(?:navbox\S*|vertical-navbox|infobox\S*|taxobox|mw-editsection|reflist|references|mw-references-wrap|reference|noprint|metadata|ambox\S*|mbox-\S+|hatnote|toc|mw-empty-elt|printfooter|catlinks|sistersitebox|authority-control|mw-jump-link|mw-cite-backlink|navigation-not-searchable|shortdescription|mw-kartographer\S*|portal(?:box|-bar\S*)?|sidebar)(?:\s|$)/i;
const SKIP_ID = /^(?:toc|references|mw-navigation|footer|catlinks|siteSub|contentSub|jump-to-nav)$/i;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'track', 'area', 'base', 'col', 'embed', 'param']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'dd', 'dt',
  'blockquote', 'pre', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'details', 'summary', 'caption',
  'center', 'address', 'hr', 'br', 'body', 'html',
]);

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s/>=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function shouldSkip(tag: string, a: Record<string, string>): boolean {
  if (SKIP_TAGS.has(tag)) return true;
  if (a.class && SKIP_CLASS.test(a.class)) return true;
  if (a.id && SKIP_ID.test(a.id)) return true;
  if (a.role === 'navigation' || a.role === 'note' || a['aria-hidden'] === 'true' || a.hidden !== undefined) return true;
  if (a.style && /display\s*:\s*none/i.test(a.style)) return true;
  return false;
}

type Visitor = {
  open?: (tag: string, a: Record<string, string>) => void;
  close?: (tag: string) => void;
  text?: (t: string) => void;
};

/** Walks the HTML, skipping chrome subtrees, calling the visitor for kept nodes. */
function walk(html: string, v: Visitor) {
  // Only the body matters when present.
  const bodyStart = html.search(/<body[\s>]/i);
  const src = bodyStart >= 0 ? html.slice(bodyStart) : html;
  let skipTag: string | null = null;
  let skipDepth = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    const tok = m[0];
    if (tok.startsWith('<!')) continue;
    const name = m[1]?.toLowerCase();
    if (!name) {
      if (!skipTag) v.text?.(tok);
      continue;
    }
    const closing = tok[1] === '/';
    const selfClosing = m[3] === '/' || VOID_TAGS.has(name);
    if (skipTag) {
      if (name === skipTag) {
        if (closing) {
          if (--skipDepth === 0) skipTag = null;
        } else if (!selfClosing) skipDepth++;
      }
      continue;
    }
    if (closing) {
      v.close?.(name);
      continue;
    }
    const a = attrs(m[2]);
    if (shouldSkip(name, a)) {
      if (!selfClosing) {
        skipTag = name;
        skipDepth = 1;
      }
      continue;
    }
    v.open?.(name, a);
    if (selfClosing) v.close?.(name);
  }
}

/** Plain text with paragraphs separated by blank lines. */
export function htmlToText(html: string, maxChars = 8000): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const parts: string[] = [];
  let pre = 0;
  let cellIndex = 0;
  const newline = (n: number) => parts.push(n > 1 ? '\n\n' : '\n');
  walk(html, {
    open(tag) {
      if (tag === 'pre') pre++;
      if (tag === 'li') parts.push('\n• ');
      else if (tag === 'tr') {
        cellIndex = 0;
        newline(1);
      } else if (tag === 'td' || tag === 'th') {
        if (cellIndex++ > 0) parts.push(' · ');
      } else if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'table' || tag === 'blockquote') newline(2);
      else if (tag === 'br') newline(1);
      else if (BLOCK_TAGS.has(tag)) newline(1);
    },
    close(tag) {
      if (tag === 'pre') pre = Math.max(0, pre - 1);
      if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'table' || tag === 'blockquote') newline(2);
      else if (BLOCK_TAGS.has(tag) && tag !== 'br') newline(1);
    },
    text(t) {
      const decoded = decodeEntities(t);
      parts.push(pre ? decoded : decoded.replace(/[ \t\r\n\f ]+/g, ' '));
    },
  });
  let text = parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/(?:\n• *(?=\n|$))+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (text.length > maxChars) {
    const cut = text.lastIndexOf(' ', maxChars);
    text = `${text.slice(0, cut > maxChars * 0.8 ? cut : maxChars).trimEnd()}…`;
  }
  return { title, text };
}

const ASSET_EXT = /\.(?:css|js|mjs|json|png|jpe?g|gif|webp|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogv|ogg|oga|mp3|m4a|wav|opus|vtt|pdf|zip|epub)$/i;

/** Resolves an href against the directory of `basePath`; null for external/fragment-only links. */
export function resolveZimHref(href: string, basePath: string): string | null {
  let h = href.trim();
  if (!h || h.startsWith('#') || h.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h)) return null; // http:, mailto:, javascript:…
  h = h.replace(/[#?].*$/, '');
  if (!h) return null;
  let segments: string[];
  if (h.startsWith('/')) segments = [];
  else {
    segments = basePath.split('/');
    segments.pop(); // drop the file name
  }
  for (const seg of h.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  const joined = segments.join('/');
  try {
    return decodeURIComponent(joined);
  } catch {
    return joined;
  }
}

/** Internal article links in document order, de-duplicated, chrome and assets excluded. */
export function extractLinks(html: string, basePath: string): { path: string; title: string }[] {
  const out: { path: string; title: string }[] = [];
  const seen = new Set<string>([basePath]);
  let current: { path: string; title: string; text: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.text.join('').replace(/\s+/g, ' ').trim();
    const title = text || current.title || current.path;
    if (!seen.has(current.path)) {
      seen.add(current.path);
      out.push({ path: current.path, title });
    }
    current = null;
  };
  walk(html, {
    open(tag, a) {
      if (tag !== 'a') return;
      flush();
      const href = a.href;
      if (!href) return;
      const path = resolveZimHref(decodeEntities(href), basePath);
      if (!path || ASSET_EXT.test(path) || /^(?:-|I|_[a-z]+_)\//.test(path)) return;
      current = { path, title: decodeEntities(a.title ?? ''), text: [] };
    },
    close(tag) {
      if (tag === 'a') flush();
    },
    text(t) {
      current?.text.push(decodeEntities(t));
    },
  });
  flush();
  return out;
}

export type Heading = { id: string; title: string; level: 2 | 3 };

/**
 * Section headings (h2/h3) that can be linked to with `#id`, in document order.
 * MediaWiki dumps put the anchor either on the heading or on an inner
 * `<span class="mw-headline" id=…>`.
 */
export function extractHeadings(html: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Set<string>();
  const re = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const level = Number(m[1]) as 2 | 3;
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[2])?.[1] ?? /\bid\s*=\s*["']([^"']+)["']/i.exec(m[3])?.[1];
    const title = decodeEntities(stripTags(m[3]).replace(/\[\s*(edit|editar)\s*\]/gi, '')).trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, level });
  }
  return out;
}
