#!/usr/bin/env node
// Validates src/data/catalog.json: schema basics + every download URL resolves.
//
//   node scripts/validate-catalog.mjs            # schema + URL checks
//   node scripts/validate-catalog.mjs --offline  # schema only
//   node scripts/validate-catalog.mjs path/to/catalog.json
//
// No dependencies (Node >= 18 for global fetch). Exits 1 on any error.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const catalogPath = resolve(args.find((a) => !a.startsWith('--')) ?? `${ROOT}/src/data/catalog.json`);
const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;
const SIZE_TOLERANCE = 0.05;

const HUES = new Set(['medicine', 'survival', 'education', 'diy', 'agriculture', 'computing', 'reference', 'maps', 'ai', 'courses', 'neutral']);
const LANGS = new Set(['es', 'en', 'mul']);
const WIKIPEDIA_OPTIONS = new Set(['top-mini', 'top-nopic', 'all-mini', 'all-nopic', 'all-maxi']);

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function checkLocalized(where, field, v) {
  if (!isObj(v)) return err(where, `${field} must be { es, en }`);
  for (const l of ['es', 'en']) if (!nonEmpty(v[l])) err(where, `${field}.${l} is empty`);
}

// lucide-react-native icon names, when node_modules is installed.
function loadLucideIcons() {
  const dts = `${ROOT}/node_modules/lucide-react-native/dist/types/lucide-react-native.d.ts`;
  if (!existsSync(dts)) return null;
  const names = new Set();
  for (const m of readFileSync(dts, 'utf8').matchAll(/declare const (\w+): LucideIcon/g)) names.add(m[1]);
  return names.size ? names : null;
}
const icons = loadLucideIcons();
function checkIcon(where, icon) {
  if (!nonEmpty(icon)) return err(where, 'icon is empty');
  if (icons && !icons.has(icon)) err(where, `icon "${icon}" is not exported by lucide-react-native`);
}

// ---------------------------------------------------------------------------
// Schema

let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${catalogPath}: ${e.message}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.version ?? '')) err('catalog', 'version must be YYYY-MM-DD');
const resources = isObj(catalog.resources) ? catalog.resources : (err('catalog', 'resources must be an object'), {});
const subjects = Array.isArray(catalog.courseSubjects) ? catalog.courseSubjects : (err('catalog', 'courseSubjects must be an array'), []);
const subjectSlugs = new Set(subjects.map((s) => s?.slug));
const referenced = new Set();

for (const [key, r] of Object.entries(resources)) {
  const w = `resources.${key}`;
  if (!isObj(r)) { err(w, 'must be an object'); continue; }
  if (r.id !== key) err(w, `id "${r.id}" does not match key`);
  if (r.kiwixName !== undefined && !nonEmpty(r.kiwixName)) err(w, 'kiwixName is empty');
  checkLocalized(w, 'title', r.title);
  checkLocalized(w, 'description', r.description);
  if (!LANGS.has(r.language)) err(w, `language "${r.language}" not in es|en|mul`);
  if (!/^https:\/\/\S+\.zim$/.test(r.url ?? '')) err(w, 'url must be an https .zim URL');
  if (!Number.isInteger(r.sizeMB) || r.sizeMB <= 0) err(w, 'sizeMB must be a positive integer');
  if (!/^\d{4}-\d{2}$/.test(r.version ?? '')) err(w, 'version must be YYYY-MM');
  if (!nonEmpty(r.category)) err(w, 'category is empty');
  if (r.isCourse) {
    if (!nonEmpty(r.subject)) err(w, 'isCourse without subject');
    else if (!subjectSlugs.has(r.subject)) err(w, `subject "${r.subject}" is not in courseSubjects`);
  } else if (r.subject !== undefined) warn(w, 'subject set but isCourse is not');
  if (r.medical !== undefined && typeof r.medical !== 'boolean') err(w, 'medical must be boolean');
  if (r.url && r.version && !r.url.includes(`_${r.version}`)) warn(w, `url does not contain version ${r.version}`);
}

function ref(where, id) {
  referenced.add(id);
  if (!resources[id]) err(where, `unknown resource "${id}"`);
}

const categories = Array.isArray(catalog.categories) ? catalog.categories : (err('catalog', 'categories must be an array'), []);
const categorySlugs = new Set();
for (const [ci, c] of categories.entries()) {
  const w = `categories[${c?.slug ?? ci}]`;
  if (!nonEmpty(c?.slug)) { err(w, 'slug is empty'); continue; }
  if (categorySlugs.has(c.slug)) err(w, 'duplicate slug');
  categorySlugs.add(c.slug);
  if (!HUES.has(c.hue)) err(w, `hue "${c.hue}" is not a theme hue`);
  checkIcon(w, c.icon);
  checkLocalized(w, 'name', c.name);
  checkLocalized(w, 'description', c.description);
  if (!Array.isArray(c.tiers) || c.tiers.length === 0) { err(w, 'tiers must be a non-empty array'); continue; }
  const seenTiers = new Map();
  for (const t of c.tiers) {
    const tw = `${w}.tiers[${t?.slug}]`;
    if (!nonEmpty(t?.slug)) { err(tw, 'slug is empty'); continue; }
    if (seenTiers.has(t.slug)) err(tw, 'duplicate tier slug');
    checkLocalized(tw, 'name', t.name);
    checkLocalized(tw, 'description', t.description);
    if (!Array.isArray(t.resources)) { err(tw, 'resources must be an array'); continue; }
    const inherited = new Set();
    if (t.includesTier !== undefined) {
      if (!seenTiers.has(t.includesTier)) err(tw, `includesTier "${t.includesTier}" must name an earlier tier of the same category`);
      else for (const id of seenTiers.get(t.includesTier)) inherited.add(id);
    }
    const own = new Set();
    for (const id of t.resources) {
      ref(tw, id);
      if (own.has(id)) err(tw, `duplicate resource "${id}"`);
      if (inherited.has(id)) err(tw, `"${id}" is already included via ${t.includesTier}`);
      own.add(id);
    }
    seenTiers.set(t.slug, new Set([...inherited, ...own]));
    for (const lang of ['es', 'en']) {
      if (![...own].some((id) => resources[id]?.language === lang || resources[id]?.language === 'mul')) {
        warn(tw, `no ${lang}/mul resources in this tier`);
      }
    }
  }
  if (!c.tiers.some((t) => t.recommended)) warn(w, 'no recommended tier');
}
for (const r of Object.values(resources)) {
  if (isObj(r) && nonEmpty(r.category) && !categorySlugs.has(r.category) && !['reference'].includes(r.category)) {
    warn(`resources.${r.id}`, `category "${r.category}" is not a catalog category`);
  }
}

const wikipedia = isObj(catalog.wikipedia) ? catalog.wikipedia : (err('catalog', 'wikipedia must be an object'), {});
for (const lang of ['es', 'en']) {
  const list = wikipedia[lang];
  const w = `wikipedia.${lang}`;
  if (!Array.isArray(list) || list.length === 0) { err(w, 'must be a non-empty array'); continue; }
  let prev = 0;
  const ids = new Set();
  for (const o of list) {
    const ow = `${w}[${o?.id}]`;
    if (!WIKIPEDIA_OPTIONS.has(o?.id)) err(ow, 'unknown option id');
    if (ids.has(o?.id)) err(ow, 'duplicate option');
    ids.add(o?.id);
    checkLocalized(ow, 'name', o?.name);
    checkLocalized(ow, 'description', o?.description);
    ref(ow, o?.resourceId);
    const r = resources[o?.resourceId];
    if (r) {
      if (r.language !== lang) err(ow, `resource language is ${r.language}`);
      if (r.sizeMB < prev) err(ow, 'options must be sorted smallest first');
      prev = r.sizeMB;
    }
  }
}

const subjectSeen = new Set();
for (const s of subjects) {
  const w = `courseSubjects[${s?.slug}]`;
  if (!nonEmpty(s?.slug)) { err(w, 'slug is empty'); continue; }
  if (subjectSeen.has(s.slug)) err(w, 'duplicate slug');
  subjectSeen.add(s.slug);
  if (!HUES.has(s.hue)) err(w, `hue "${s.hue}" is not a theme hue`);
  checkIcon(w, s.icon);
  checkLocalized(w, 'name', s.name);
}

const courses = Array.isArray(catalog.courses) ? catalog.courses : (err('catalog', 'courses must be an array'), []);
const courseSet = new Set();
for (const id of courses) {
  ref('courses', id);
  if (courseSet.has(id)) err('courses', `duplicate "${id}"`);
  courseSet.add(id);
  if (resources[id] && !resources[id].isCourse) err('courses', `"${id}" is not marked isCourse`);
}
for (const r of Object.values(resources)) {
  if (isObj(r) && r.isCourse && !courseSet.has(r.id)) err(`resources.${r.id}`, 'isCourse but missing from courses');
}
for (const id of Object.keys(resources)) if (!referenced.has(id)) warn(`resources.${id}`, 'not referenced by any tier, course or wikipedia option');

// ---------------------------------------------------------------------------
// URL checks

async function probe(url) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
      });
      if (method === 'GET') await res.body?.cancel().catch(() => {});
      let bytes = null;
      const range = res.headers.get('content-range');
      if (range && /\/(\d+)$/.test(range)) bytes = Number(range.match(/\/(\d+)$/)[1]);
      else if (res.headers.get('content-length')) bytes = Number(res.headers.get('content-length'));
      return { status: res.status, ok: res.status === 200 || res.status === 206, bytes, finalUrl: res.url };
    } finally {
      clearTimeout(timer);
    }
  };
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      last = await attempt(i === 0 ? 'HEAD' : 'GET');
      if (last.ok) return last;
    } catch (e) {
      last = { status: 0, ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
    }
  }
  return last;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const list = Object.values(resources).filter((r) => isObj(r) && nonEmpty(r.url));
let urlFailures = 0;
if (!offline) {
  console.log(`Checking ${list.length} URLs (concurrency ${CONCURRENCY})…`);
  let done = 0;
  const results = await pool(list, CONCURRENCY, async (r) => {
    const res = await probe(r.url);
    done++;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${list.length}`);
    return { r, res };
  });
  if (process.stdout.isTTY) process.stdout.write('\n');
  for (const { r, res } of results) {
    if (!res.ok) {
      urlFailures++;
      err(`resources.${r.id}`, `URL failed (${res.error ?? `HTTP ${res.status}`}): ${r.url}`);
      continue;
    }
    if (res.bytes) {
      const mb = res.bytes / 1e6;
      if (Math.abs(mb - r.sizeMB) / r.sizeMB > SIZE_TOLERANCE && Math.abs(mb - r.sizeMB) > 1) {
        warn(`resources.${r.id}`, `sizeMB ${r.sizeMB} but server reports ${Math.round(mb)} MB`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report

const byLang = {};
for (const r of list) byLang[r.language] = (byLang[r.language] ?? 0) + 1;
console.log(`\nCatalog ${catalog.version}: ${list.length} resources (${Object.entries(byLang).map(([l, n]) => `${l} ${n}`).join(', ')}), ` +
  `${categories.length} categories, ${courses.length} courses`);

function tierTotals(lang) {
  const parts = [];
  for (const c of categories) {
    const acc = new Map();
    for (const t of c.tiers ?? []) {
      const ids = new Set([...(acc.get(t.includesTier) ?? []), ...(t.resources ?? [])]);
      acc.set(t.slug, ids);
      const mb = [...ids].map((id) => resources[id]).filter((r) => r && (r.language === lang || r.language === 'mul'))
        .reduce((s, r) => s + r.sizeMB, 0);
      parts.push(`  ${t.slug.padEnd(28)} ${String(mb).padStart(7)} MB`);
    }
  }
  return parts.join('\n');
}
for (const lang of ['es', 'en']) console.log(`\nCumulative tier sizes for "${lang}" users (${lang} + mul):\n${tierTotals(lang)}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`\n✓ Catalog valid${offline ? ' (URLs not checked: --offline)' : `, all ${list.length} URLs reachable`}.`);
