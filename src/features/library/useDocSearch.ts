// Search-as-you-type over the passages of the PDFs inside archives (the document index the assistant
// reads, documents.ts), for the library's global search in full-text mode.
import { useEffect, useRef, useState } from 'react';

import { searchDocuments } from './documents';
import type { DocHit } from './documents-core';

/** Debounced like the full-text search; previous results stay on screen while the next query runs. */
export function useDocSearch(itemIds: string[], query: string, enabled: boolean, limit = 12) {
  const [state, setState] = useState<{ key: string; hits: DocHit[] }>({ key: '', hits: [] });
  const latest = useRef('');
  const q = query.trim();
  const ids = itemIds.join('|');
  const reqKey = `${limit}\u0000${ids}\u0000${q}`;
  const active = enabled && q.length > 0 && itemIds.length > 0;

  useEffect(() => {
    latest.current = reqKey;
    if (!active) return;
    const timer = setTimeout(async () => {
      const hits = await searchDocuments(ids.split('|'), [q], limit).catch(() => [] as DocHit[]);
      if (latest.current !== reqKey) return;
      setState({ key: reqKey, hits });
    }, 350);
    return () => clearTimeout(timer);
  }, [reqKey, active, ids, q, limit]);

  return { hits: active ? state.hits : [], loading: active && state.key !== reqKey };
}
