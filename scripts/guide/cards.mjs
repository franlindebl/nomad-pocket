// Reads the emergency guide's card files (src/data/guide/<id>.<lang>.md, format in
// docs/emergency-guide/FORMAT.md): front matter + Markdown body. Shared by build.mjs and check-sources.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const cardsDir = path.join(root, 'src/data/guide');

export const LANGS = ['es', 'en'];
const KINDS = ['copy', 'excerpt', 'translation', 'own'];
const REQUIRED = ['id', 'number', 'title', 'vital', 'health', 'kind', 'source', 'licence', 'keywords'];

/** Parses one card file; throws with the file name on any format error. */
export function parseCard(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const name = path.basename(file);
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${name}: no front matter`);
  const meta = { sources: [] };
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${name}: bad front matter line "${line}"`);
    const [, key, value] = kv;
    if (key === 'source') {
      const parts = value.split('|').map((s) => s.trim());
      if (parts.length !== 4 || !/^https?:\/\//.test(parts[2])) throw new Error(`${name}: source needs "agency | title | url | date"`);
      meta.sources.push({ agency: parts[0], title: parts[1], url: parts[2], date: parts[3] });
    } else meta[key] = value.trim();
  }
  for (const k of REQUIRED) if (k === 'source' ? !meta.sources.length : !meta[k]) throw new Error(`${name}: missing ${k}`);
  const fileMatch = /^([a-z0-9-]+)\.([a-z]{2})\.md$/.exec(name);
  if (!fileMatch || fileMatch[1] !== meta.id) throw new Error(`${name}: id "${meta.id}" doesn't match the file name`);
  const lang = fileMatch[2];
  if (!LANGS.includes(lang)) throw new Error(`${name}: unknown language ${lang}`);
  if (!KINDS.includes(meta.kind)) throw new Error(`${name}: kind must be one of ${KINDS.join(', ')}`);
  for (const k of ['vital', 'health']) if (!['yes', 'no'].includes(meta[k])) throw new Error(`${name}: ${k} must be yes or no`);
  if (!/^\d+\.\d+$/.test(meta.number)) throw new Error(`${name}: number must look like 1.1`);
  if (meta.kind === 'translation' && !LANGS.includes(meta.translatedFrom ?? '')) throw new Error(`${name}: translation needs translatedFrom`);
  if (meta.kind === 'own' && !meta.basis) throw new Error(`${name}: own card needs basis`);
  const body = m[2].trim();
  if (!body) throw new Error(`${name}: empty body`);
  if (/\]\(|!\[|^\s*\|/m.test(body)) throw new Error(`${name}: no links, images or tables in the body`);
  const list = (v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const keywords = list(meta.keywords);
  const see = list(meta.see);
  return {
    file,
    id: meta.id,
    lang,
    number: meta.number,
    title: meta.title,
    vital: meta.vital === 'yes',
    health: meta.health === 'yes',
    kind: meta.kind,
    sources: meta.sources,
    licence: meta.licence,
    keywords,
    ...(see.length ? { see } : {}),
    ...(meta.note ? { note: meta.note } : {}),
    ...(meta.transcribed === 'yes' ? { transcribed: true } : {}),
    ...(meta.translatedFrom ? { translatedFrom: meta.translatedFrom } : {}),
    ...(meta.basis ? { basis: meta.basis } : {}),
    body,
  };
}

/** Every card file, parsed, sorted by number then language. */
export function readCards() {
  if (!fs.existsSync(cardsDir)) return [];
  const cards = fs
    .readdirSync(cardsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseCard(path.join(cardsDir, f)));
  const key = (c) => c.number.split('.').map((n) => n.padStart(3, '0')).join('.');
  return cards.sort((a, b) => key(a).localeCompare(key(b)) || a.lang.localeCompare(b.lang));
}
