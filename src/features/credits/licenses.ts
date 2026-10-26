// Loads the credits data (src/data/licenses.json, ~0.8 MB of licence texts) on first use
// instead of at startup: Expo's Metro config doesn't inline requires, so a top-level import
// would build the whole object when the route tree loads.
import type { CreditsData } from './credits-core';

export {
  creditKey,
  creditSubtitle,
  filterCredits,
  findCredit,
  textBlocks,
  type Credit,
  type CreditKind,
  type CreditsData,
} from './credits-core';

export const SOURCE_URL = 'https://github.com/franlindebl/nomad-pocket';

let cache: CreditsData | undefined;

export function getCredits(): CreditsData {
  cache ??= require('../../data/licenses.json') as CreditsData;
  return cache;
}
