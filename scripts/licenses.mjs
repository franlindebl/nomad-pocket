#!/usr/bin/env node
// Builds src/data/licenses.json, the data behind Settings › Credits & licenses.
//
// JavaScript side: every production package in package-lock.json (dev-only ones left out)
// with the licence file it ships in node_modules (LICENSE/LICENCE/COPYING plus NOTICE, which
// Apache-2.0 asks to reproduce). Packages that ship no file get the standard text for their
// SPDX id (scripts/licenses/native.json `spdxFallback`, or a per-package `jsTexts` override).
// Native and data side: the hand-kept scripts/licenses/native.json.
//
// The output is committed, so builds need neither this script nor the network. Re-run it
// after changing dependencies or native.json:
//   node scripts/licenses.mjs           write src/data/licenses.json
//   node scripts/licenses.mjs --check   exit 1 if the committed file is stale
// Identical texts are stored once (`texts`) and referenced by index.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const here = path.join(root, 'scripts/licenses');
const outFile = path.join(root, 'src/data/licenses.json');
const hand = JSON.parse(fs.readFileSync(path.join(here, 'native.json'), 'utf8'));

const texts = [];
const textIndex = new Map();
/** Stores a text once and returns its index; null for no text. */
function addText(text) {
  if (!text) return null;
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  if (!clean) return null;
  if (!textIndex.has(clean)) {
    textIndex.set(clean, texts.length);
    texts.push(clean);
  }
  return textIndex.get(clean);
}
const readHand = (rel) => (rel ? fs.readFileSync(path.join(here, rel), 'utf8') : null);

function spdxOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(' OR ');
  if (l && typeof l === 'object') return l.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

function repoUrl(pkg) {
  const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!r) return pkg.homepage ?? null;
  return r
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^(?!https?:)([\w-]+\/[\w.-]+)$/, 'https://github.com/$1')
    .replace(/\.git$/, '');
}

/** LICENSE-like files first, NOTICE after; README and the like never count. */
function licenseText(dir) {
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  const pick = (re) => files.filter((f) => re.test(f)).sort();
  const parts = [...pick(/^(licen[cs]e|copying)([-._].*)?$/i), ...pick(/^notice([-._].*)?$/i)];
  return parts.length ? parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n----\n\n') : null;
}

function fallbackText(name, spdx) {
  if (hand.jsTexts?.[name]) return readHand(hand.jsTexts[name]);
  const id = spdx.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/)[0];
  return hand.spdxFallback?.[id] ? readHand(hand.spdxFallback[id]) : null;
}

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const seen = new Set();
const js = [];
for (const [key, entry] of Object.entries(lock.packages)) {
  if (!key.startsWith('node_modules/') || entry.dev || entry.devOptional || entry.link) continue;
  const dir = path.join(root, key);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    // Platform binaries for other hosts (optional) aren't installed; anything else is a broken tree.
    if (entry.optional) continue;
    throw new Error(`${key} is in package-lock.json but not installed: run npm install first`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const name = pkg.name ?? key.slice(key.lastIndexOf('node_modules/') + 13);
  const id = `${name}@${pkg.version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const spdx = spdxOf(pkg);
  const own = licenseText(dir);
  js.push({
    id,
    name,
    version: pkg.version,
    license: spdx,
    url: repoUrl(pkg),
    text: addText(own ?? fallbackText(name, spdx)),
    ...(own ? {} : { standard: true }),
  });
}
js.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const handEntry = ({ text, ...rest }) => ({ ...rest, text: addText(readHand(text)) });
const data = {
  app: handEntry(hand.app),
  native: hand.native.map(handEntry),
  data: hand.data.map(handEntry),
  js,
  texts,
};
const missing = [...data.native, ...data.data, ...js].filter(
  (e) => e.text === null && !hand.native.concat(hand.data).some((h) => h.id === e.id),
);
for (const e of missing) console.warn(`[licenses] no licence text for ${e.id} (${e.license})`);

const json = JSON.stringify(data) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== json) {
    console.error('[licenses] src/data/licenses.json is stale: run node scripts/licenses.mjs');
    process.exit(1);
  }
  console.log('[licenses] up to date');
} else {
  fs.writeFileSync(outFile, json);
  console.log(
    `[licenses] ${js.length} JS packages, ${data.native.length} native, ${data.data.length} data; ${texts.length} texts, ${(json.length / 1024).toFixed(0)} KB`,
  );
}
