#!/usr/bin/env node
// Checks that the emergency guide's copied cards say what their sources say (docs/emergency-guide/FORMAT.md):
// every sentence of a `copy` or `excerpt` card must appear in the text of one of its sources. Fetches each source
// URL once (PDFs through pdftotext) into a cache outside the repo, normalises both sides (case, quotes, dashes,
// punctuation, hyphenation, Markdown markers, our bracketed notes) and prints the sentences it can't find.
//   node scripts/guide/check-sources.mjs              every card
//   node scripts/guide/check-sources.mjs cpr-adult    some cards (ids)
//   GUIDE_CACHE=/path node …                          cache directory (default $TMPDIR/nomad-guide-sources)
// Exit 1 when a sentence is missing. Translations and own cards aren't checked here (a person reviews them).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readCards } from './cards.mjs';

const cache = process.env.GUIDE_CACHE || path.join(os.tmpdir(), 'nomad-guide-sources');
fs.mkdirSync(cache, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', deg: '°', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', iquest: '¿', iexcl: '¡', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', frac12: '½', frac14: '¼', frac34: '¾', ordm: 'º', ordf: 'ª', middot: '·', shy: '', reg: '®', copy: '©', trade: '™' };

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    // Inline tags join their text ("<u>J</u>abón"); the others separate it.
    .replace(/<\/?(?:a|abbr|b|em|i|span|strong|sub|sup|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n] ?? m);
}

async function sourceText(url) {
  const file = path.join(cache, crypto.createHash('sha1').update(url).digest('hex') + '.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text;
  if ((res.headers.get('content-type') ?? '').includes('pdf') || buf.subarray(0, 5).toString() === '%PDF-') {
    const pdf = file.replace(/\.txt$/, '.pdf');
    fs.writeFileSync(pdf, buf);
    text = execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  } else text = htmlToText(buf.toString('utf8'));
  fs.writeFileSync(file, text);
  return text;
}

/** Letters and digits only, lower case, one space between words; hyphens and soft hyphens joined. */
export function norm(s) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/­/g, '')
    .replace(/(\p{L})[-‐‑]\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/[-‐‑–—]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The card's sentences as the check sees them: our bracketed notes and omission marks out, headings of 1–3 words skipped. */
function sentences(body) {
  const out = [];
  for (const raw of body.split('\n')) {
    let line = raw.replace(/\[[^\]]*\]/g, ' ').trim();
    if (!line) continue;
    const heading = /^#+\s/.test(line);
    line = line.replace(/^#+\s+|^[-*]\s+|^\d+[.)]\s+/, '').replace(/\*\*|__/g, '');
    for (const s of line.split(/(?<=[.!?;:])\s+/)) {
      const n = norm(s);
      if (!n) continue;
      if (heading && n.split(' ').length <= 3) continue;
      out.push({ text: s.trim(), n });
    }
  }
  return out;
}

const ids = new Set(process.argv.slice(2));
const all = readCards().filter((c) => (!ids.size || ids.has(c.id)) && (c.kind === 'copy' || c.kind === 'excerpt'));
// Text transcribed from an image (an infographic with no text layer) was compared with it by a person.
for (const c of all.filter((c) => c.transcribed)) console.log(`img  ${c.id}.${c.lang} (transcribed from an image, checked by hand)`);
const cards = all.filter((c) => !c.transcribed);
let missing = 0;
let failed = 0;
for (const card of cards) {
  const texts = [];
  for (const s of card.sources) {
    try {
      texts.push(norm(await sourceText(s.url)));
    } catch (e) {
      failed++;
      console.log(`${card.id}.${card.lang}: can't fetch ${s.url} (${e.message})`);
    }
  }
  if (!texts.length) continue;
  const misses = sentences(card.body).filter((s) => !texts.some((t) => t.includes(s.n)));
  if (!misses.length) {
    console.log(`ok   ${card.id}.${card.lang}`);
    continue;
  }
  missing += misses.length;
  console.log(`MISS ${card.id}.${card.lang} (${misses.length})`);
  for (const m of misses) console.log(`     · ${m.text}`);
}
console.log(`\n${cards.length} cards checked, ${missing} sentences not found${failed ? `, ${failed} sources not fetched` : ''}`);
process.exit(missing || failed ? 1 : 0);
