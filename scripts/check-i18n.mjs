#!/usr/bin/env node
// i18n key check for Nomad Pocket.
// Lists keys referenced via t('...') / i18n.t('...') that are missing from es or en.
//
// Rules:
//  - namespaces = file names in src/i18n/locales/<lang>/*.json; default namespace "common"
//  - "ns:key" selects a namespace explicitly
//  - `const { t } = useTranslation('ns')` / `const { t: tc } = useTranslation()` bind a
//    variable to a namespace; the nearest binding ABOVE the call (same file) wins
//  - function parameters named like a t-function (`t: (k: string ...) => string`) default to common
//  - plural keys: `key` is satisfied by key, key_one, key_other, key_zero, ... (i18next v21+ JSON v4)
//  - template keys (`status.${s}`) are checked as patterns: at least one match per language,
//    and the set of matches must be identical in es and en
//  - unused keys are listed for information only (never fail): a key counts as used when a
//    t() call or template matches it, or its text appears as a string literal ('ns:key' or
//    'key') somewhere in src (keys kept in data, e.g. `{ labelKey: 'x.y' }`)
//
// Usage: node check-i18n.mjs [projectRoot]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const localesDir = path.join(root, 'src/i18n/locales');
const LANGS = ['es', 'en'];
const DEFAULT_NS = 'common';
const PLURAL_SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other'];

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

const keys = {}; // lang -> ns -> Set
for (const lang of LANGS) {
  keys[lang] = {};
  for (const f of fs.readdirSync(path.join(localesDir, lang))) {
    if (!f.endsWith('.json')) continue;
    keys[lang][f.replace(/\.json$/, '')] = flatten(JSON.parse(fs.readFileSync(path.join(localesDir, lang, f), 'utf8')));
  }
}
const namespaces = new Set(LANGS.flatMap((l) => Object.keys(keys[l])));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

function has(lang, ns, key) {
  const set = keys[lang][ns];
  if (!set) return false;
  return PLURAL_SUFFIXES.some((s) => set.has(key + s));
}

function matches(lang, ns, re) {
  const set = keys[lang][ns];
  if (!set) return [];
  return [...set].filter((k) => re.test(k)).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, ''));
}

let checked = 0;
const used = new Set(); // "ns:key" of static calls
const usedPatterns = []; // { ns, re } of template calls
let allSource = '';
const missing = [];
const dynamic = [];
const unknownBinding = [];

for (const file of walk(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  allSource += src;
  const rel = path.relative(root, file);
  const lines = src.split('\n');
  // Bindings: { name, ns, line }
  const bindings = [];
  const hookRe = /const\s*\{([^}]*)\}\s*=\s*useTranslation\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  for (let m; (m = hookRe.exec(src)); ) {
    const line = src.slice(0, m.index).split('\n').length;
    const ns = m[2] ?? m[3] ?? DEFAULT_NS;
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((s) => s.trim());
      if (orig === 't') bindings.push({ name: alias || 't', ns, line });
    }
  }
  // t-typed function params default to common.
  const paramRe = /\b([A-Za-z_$][\w$]*)\s*:\s*\(\s*k\s*:\s*string/g;
  for (let m; (m = paramRe.exec(src)); ) {
    bindings.push({ name: m[1], ns: DEFAULT_NS, line: src.slice(0, m.index).split('\n').length, param: true });
  }
  const names = [...new Set([...bindings.map((b) => b.name), 'i18n.t'])];
  const esc = (s) => s.replace(/[.$]/g, '\\$&');
  const callRe = new RegExp(`(?<![\\w$.])(${names.map(esc).join('|')})\\(\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`, 'g');
  for (let m; (m = callRe.exec(src)); ) {
    const line = src.slice(0, m.index).split('\n').length;
    const name = m[1];
    let ns = DEFAULT_NS;
    if (name !== 'i18n.t') {
      const b = bindings.filter((x) => x.name === name && x.line <= line).sort((a, c) => c.line - a.line)[0];
      if (!b) {
        unknownBinding.push(`${rel}:${line}  ${name}(…) has no useTranslation binding above it`);
        continue;
      }
      ns = b.ns;
    }
    checked++;
    let raw = m[2] ?? m[3] ?? m[4];
    const isTemplate = m[4] !== undefined;
    let keyNs = ns;
    const colon = raw.indexOf(':');
    if (colon > 0 && namespaces.has(raw.slice(0, colon))) {
      keyNs = raw.slice(0, colon);
      raw = raw.slice(colon + 1);
    }
    if (isTemplate && raw.includes('${')) {
      const re = new RegExp('^' + raw.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^()|[\]\\{}]/g, '\\$&')).join('[^.]+') + '$');
      usedPatterns.push({ ns: keyNs, re });
      const per = Object.fromEntries(LANGS.map((l) => [l, [...new Set(matches(l, keyNs, re))].sort()]));
      const [a, b] = LANGS;
      const onlyA = per[a].filter((k) => !per[b].includes(k));
      const onlyB = per[b].filter((k) => !per[a].includes(k));
      const problem = !per[a].length || !per[b].length || onlyA.length || onlyB.length;
      dynamic.push(
        `${problem ? '!!' : 'ok'} ${rel}:${line}  ${keyNs}:${raw}  →  ${per[a].length} match(es)` +
          (onlyA.length ? `; only in ${a}: ${onlyA.join(', ')}` : '') +
          (onlyB.length ? `; only in ${b}: ${onlyB.join(', ')}` : '') +
          (!per[a].length || !per[b].length ? '; NO MATCH in ' + LANGS.filter((l) => !per[l].length).join('/') : ''),
      );
      continue;
    }
    used.add(`${keyNs}:${raw}`);
    const absent = LANGS.filter((l) => !has(l, keyNs, raw));
    if (absent.length) missing.push(`${rel}:${line}  ${keyNs}:${raw}  missing in ${absent.join(', ')}`);
  }
}

// Keys present in one language only (whole catalog).
const asymmetric = [];
for (const ns of namespaces) {
  const [a, b] = LANGS;
  const A = keys[a][ns] ?? new Set();
  const B = keys[b][ns] ?? new Set();
  for (const k of A) if (!B.has(k)) asymmetric.push(`${ns}:${k} only in ${a}`);
  for (const k of B) if (!A.has(k)) asymmetric.push(`${ns}:${k} only in ${b}`);
}

// Keys nothing seems to use (informational: dynamic lookups the patterns above can't see).
const literals = new Set([...allSource.matchAll(/'([^'\n]+)'|"([^"\n]+)"|`([^`$\n]+)`/g)].map((m) => m[1] ?? m[2] ?? m[3]));
const unused = [];
for (const ns of namespaces) {
  for (const full of keys[LANGS[1]][ns] ?? []) {
    const k = full.replace(/_(zero|one|two|few|many|other)$/, '');
    const hit =
      used.has(`${ns}:${k}`) ||
      usedPatterns.some((p) => p.ns === ns && p.re.test(k)) ||
      literals.has(`${ns}:${k}`) ||
      literals.has(k);
    if (!hit && !unused.includes(`${ns}:${k}`)) unused.push(`${ns}:${k}`);
  }
}

const section = (title, list) => {
  console.log(`\n== ${title} (${list.length})`);
  for (const l of list) console.log('  ' + l);
};
console.log(`checked ${checked} t() calls`);
section("Static keys missing", missing);
section('Dynamic (template) keys', dynamic);
section('Calls with unresolved t binding (check manually)', unknownBinding);
section('Keys defined in only one language', asymmetric);
section('Keys no t() call or string literal uses (informational)', unused);
process.exitCode = missing.length || dynamic.some((d) => d.startsWith('!!')) ? 1 : 0;
