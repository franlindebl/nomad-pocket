// The last searches that led somewhere (a result was opened), offered again under the Library's search.
// Before there are any, a few starter words that find something in the survival kit's archives.
import Storage from '@/db/kv';
import i18n from '@/i18n';
import { HEALTH_FEATURES } from '@/lib/health';

const KEY = 'library.recentSearches';
const MAX = 6;

function read(): string[] {
  try {
    const list = JSON.parse(Storage.getItemSync(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  const rest = read().filter((x) => x.toLocaleLowerCase() !== q.toLocaleLowerCase());
  Storage.setItemSync(KEY, JSON.stringify([q, ...rest].slice(0, MAX)));
}

/** Up to `count` queries: recent ones first, then starters (no health words without health features). */
export function suggestedSearches(count = 4): string[] {
  const t = i18n.getFixedT(null, 'library');
  const starters = [t('starters.water'), t('starters.fire'), t('starters.knots'), t('starters.shelter')];
  if (HEALTH_FEATURES) starters.push(t('starters.burns'), t('starters.fever'));
  const out: string[] = [];
  for (const q of [...read(), ...starters]) {
    if (out.length >= count) break;
    if (!out.some((x) => x.toLocaleLowerCase() === q.toLocaleLowerCase())) out.push(q);
  }
  return out;
}
