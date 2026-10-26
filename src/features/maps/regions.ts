// Bundled list of regions with bounding boxes from Natural Earth: countries (what the app
// downloads), plus Spanish autonomous communities and US states, which only name region
// maps installed by earlier versions.
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
 * Countries grouped by continent for the picker (downloads are whole countries: the
 * subdivisions in regions.json only name maps installed before that). `suggested` (the
 * phone's country) comes first in its own section.
 */
export function groupCountries(
  lang: string,
  query: string,
  titles: { continent: (c: Continent) => string; suggested: string },
  suggested?: string | null,
): RegionSection[] {
  const q = fold(query);
  const match = (r: Region) => !q || fold(r.name.es).includes(q) || fold(r.name.en).includes(q) || r.id === q;
  const sort = (a: Region, b: Region) => regionName(a, lang).localeCompare(regionName(b, lang), lang);
  const sections: RegionSection[] = [];
  const top = suggested ? byId.get(suggested) : undefined;
  if (top && top.type === 'country' && match(top) && !q) sections.push({ key: 'suggested', title: titles.suggested, data: [top] });
  for (const c of CONTINENTS) {
    if (c === 'antarctica') continue;
    const list = REGIONS.filter((r) => r.type === 'country' && r.continent === c && match(r)).sort(sort);
    if (list.length) sections.push({ key: c, title: titles.continent(c), data: list });
  }
  return sections;
}
