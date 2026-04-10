import { useEffect, useState } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry } from "../../index/query-api";
import type { AppSearchMode } from "../search";
import { useSearchIndexer } from "./use-search-indexer";

export interface SearchPanelControllerState {
  readonly query: string;
  readonly typeFilter: string;
  readonly results: readonly IndexEntry[];
  readonly searching: boolean;
}

export interface SearchPanelController extends SearchPanelControllerState {
  setQuery: (query: string) => void;
  setTypeFilter: (typeFilter: string) => void;
}

interface UseSearchPanelControllerOptions {
  open: boolean;
  searchMode: AppSearchMode;
  searchVersion: number;
  indexer?: BackgroundIndexer | null;
}

export function useSearchPanelController({
  open,
  searchMode,
  searchVersion,
  indexer,
}: UseSearchPanelControllerOptions): SearchPanelController {
  const [query, setQueryState] = useState("");
  const [typeFilter, setTypeFilterState] = useState("");

  useEffect(() => {
    if (open) {
      return;
    }
    setQueryState("");
    setTypeFilterState("");
  }, [open]);

  useEffect(() => {
    if (searchMode !== "source") {
      return;
    }
    setTypeFilterState("");
  }, [searchMode]);

  const { results, searching } = useSearchIndexer(
    open,
    query,
    typeFilter,
    searchMode,
    searchVersion,
    indexer,
  );

  return {
    query,
    typeFilter,
    results,
    searching,
    setQuery: setQueryState,
    setTypeFilter: setTypeFilterState,
  };
}
