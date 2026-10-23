// Search-as-you-type over one or more archives, grouped per archive.
import { useEffect, useRef, useState } from 'react';

import { search, suggest, type ZimSearchHit } from './zim';

export type SearchMode = 'titles' | 'fulltext';

export type GroupedResults = { itemId: string; hits: ZimSearchHit[] }[];

/**
 * Debounced search. Titles use the title index (fast, every keystroke);
 * full text uses Xapian (slower, longer debounce). Previous results stay on
 * screen while the next query runs; stale responses are dropped.
 */
export function useZimSearch(itemIds: string[], query: string, mode: SearchMode, perArchive = 20) {
  const [state, setState] = useState<{ key: string; results: GroupedResults }>({ key: '', results: [] });
  const latest = useRef('');
  const q = query.trim();
  const ids = itemIds.join('|');
  const reqKey = `${mode}\u0000${perArchive}\u0000${ids}\u0000${q}`;
  const active = q.length > 0 && itemIds.length > 0;

  useEffect(() => {
    latest.current = reqKey;
    if (!active) return;
    const targets = ids.split('|');
    const timer = setTimeout(
      async () => {
        const fn = mode === 'fulltext' ? search : suggest;
        const groups = await Promise.all(targets.map(async (id) => ({ itemId: id, hits: await fn([id], q, perArchive).catch(() => []) })));
        if (latest.current !== reqKey) return;
        setState({ key: reqKey, results: groups.filter((g) => g.hits.length) });
      },
      mode === 'fulltext' ? 350 : 120,
    );
    return () => clearTimeout(timer);
  }, [reqKey, active, ids, mode, q, perArchive]);

  return {
    results: active ? state.results : [],
    loading: active && state.key !== reqKey,
  };
}
