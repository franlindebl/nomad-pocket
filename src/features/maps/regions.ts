// Bundled list of downloadable regions: countries, Spanish autonomous
// communities and US states, with bounding boxes from Natural Earth.
import type { BBox } from '@/lib/pmtiles';

import data from './regions.json';

export type Continent = 'europe' | 'africa' | 'asia' | 'north-america' | 'south-america' | 'oceania' | 'antarctica';

export type Region = {
  id: string;
  type: 'country' | 'subdivision';
  parent?: string;
  continent: Continent;
  name: { es: string; en: string };
  bbox: BBox;
};

export const REGIONS = data.regions as Region[];

export const CONTINENTS: Continent[] = ['europe', 'north-america', 'south-america', 'africa', 'asia', 'oceania', 'antarctica'];

const byId = new Map(REGIONS.map((r) => [r.id, r]));

export function getRegion(id: string): Region | undefined {
  return byId.get(id);
}

export function regionName(r: Region, lang: string): string {
  return lang === 'es' ? r.name.es : r.name.en;
}

/** Lower-case, accent-free form for search ("Cataluña" → "cataluna"). */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type RegionSection = { key: string; title: string; data: Region[] };

/**
 * Regions grouped for the picker. Subdivisions get their own section under the
 * parent country ("Spain — autonomous communities"); search matches both names.
 */
export function groupRegions(lang: string, query: string, titles: { continent: (c: Continent) => string; subdivisions: (country: string) => string }): RegionSection[] {
  const q = fold(query);
  const match = (r: Region) => !q || fold(r.name.es).includes(q) || fold(r.name.en).includes(q) || r.id === q;
  const sort = (a: Region, b: Region) => regionName(a, lang).localeCompare(regionName(b, lang), lang);
  const sections: RegionSection[] = [];
  for (const parent of ['es', 'us']) {
    const subs = REGIONS.filter((r) => r.parent === parent && match(r)).sort(sort);
    const country = byId.get(parent);
    if (subs.length && country) sections.push({ key: `sub-${parent}`, title: titles.subdivisions(regionName(country, lang)), data: subs });
  }
  // Spanish users mostly want Spain: list the communities first.
  if (lang !== 'es') sections.reverse();
  for (const c of CONTINENTS) {
    const list = REGIONS.filter((r) => r.type === 'country' && r.continent === c && match(r)).sort(sort);
    if (list.length) sections.push({ key: c, title: titles.continent(c), data: list });
  }
  return sections;
}
