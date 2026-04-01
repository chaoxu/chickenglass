import { useState, useEffect } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry } from "../../index/query-api";
import { buildSemanticSearchQuery, type AppSearchMode } from "../search";

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
  searchMode: AppSearchMode,
  indexVersion: number,
  indexer: BackgroundIndexer | null | undefined,
): UseSearchIndexerResult {
  const [results, setResults] = useState<readonly IndexEntry[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || !indexer) {
      // Reset both results AND searching state on teardown to prevent
      // the panel from staying stuck in a loading state. (#478)
      setResults([]);
      setSearching(false);
      return;
    }

    const text = query.trim();
    const type = typeFilter || undefined;
    const isSemanticIdle = searchMode === "semantic" && !text && !type;
    const isSourceIdle = searchMode === "source" && !text;

    if (isSemanticIdle || isSourceIdle) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;

    void (async () => {
      try {
        const entries = searchMode === "semantic"
          ? await indexer.query(buildSemanticSearchQuery(text, type))
          : await indexer.querySourceText({ text });
        if (!cancelled) {
          setResults(entries);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Eagerly reset searching on cleanup so the UI never stays stuck
      // in a loading state when the effect is re-fired or torn down. (#478)
      setSearching(false);
    };
  }, [open, query, typeFilter, searchMode, indexVersion, indexer]);

  return { results, searching };
}
