import { useState, useEffect } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry, IndexQuery } from "../../index/query-api";

/** Build an IndexQuery from raw search text and optional type filter. */
function buildQuery(text: string, type: string | undefined): IndexQuery {
  // Detect label search: text starting with # or containing : like eq:foo
  const isLabel = text.startsWith("#") || /^[a-z]+-?\w*:\w/i.test(text);
  if (isLabel) {
    const label = text.startsWith("#") ? text.slice(1) : text;
    return { type, label };
  }
  return { type, content: text || undefined };
}

export interface UseSearchIndexerResult {
  results: readonly IndexEntry[];
  searching: boolean;
}

/**
 * Runs a live query against a BackgroundIndexer whenever query, typeFilter,
 * open state, or the indexer itself changes. Cancels in-flight requests on
 * cleanup to avoid stale state updates.
 */
export function useSearchIndexer(
  open: boolean,
  query: string,
  typeFilter: string,
  indexer: BackgroundIndexer | null | undefined,
): UseSearchIndexerResult {
  const [results, setResults] = useState<readonly IndexEntry[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || !indexer) {
      setResults([]);
      return;
    }

    const text = query.trim();
    const type = typeFilter || undefined;
    const indexQuery = buildQuery(text, type);

    setSearching(true);
    let cancelled = false;

    indexer.query(indexQuery).then(
      (entries) => {
        if (!cancelled) {
          setResults(entries);
          setSearching(false);
        }
      },
      () => {
        if (!cancelled) {
          setResults([]);
          setSearching(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, query, typeFilter, indexer]);

  return { results, searching };
}
