// The emergency guide bundled with the app (src/data/guide.json, `node scripts/guide/build.mjs`): the cards
// this build may show (none about health on Android) and one search index per language, built on first use.
import rawGuide from '@/data/guide.json';
import { HEALTH_FEATURES } from '@/lib/health';

import { GuideIndex, visibleCards, type GuideCard } from './guide-core';

type Lang = 'es' | 'en';

const cards: GuideCard[] = visibleCards((rawGuide as { cards: GuideCard[] }).cards, HEALTH_FEATURES);
const byId = new Map(cards.map((c) => [c.id, c]));
const indexes = new Map<Lang, GuideIndex>();

export function guideCards(): GuideCard[] {
  return cards;
}

export function getGuideCard(id: string): GuideCard | undefined {
  return byId.get(id);
}

export function guideIndex(lang: Lang): GuideIndex {
  let index = indexes.get(lang);
  if (!index) {
    index = new GuideIndex(cards, lang);
    indexes.set(lang, index);
  }
  return index;
}
