import { useEffect, useState } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry } from "../../index/query-api";
import { buildSemanticSearchQuery, type AppSearchMode } from "../search";

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

const DEFAULT_SEARCH_PANEL_CONTROLLER_STATE: SearchPanelControllerState = {
  query: "",
  typeFilter: "",
  results: [],
  searching: false,
};

function clearSearchResults(
  state: SearchPanelControllerState,
): SearchPanelControllerState {
  if (state.results.length === 0 && !state.searching) {
    return state;
  }
  return {
    ...state,
    results: [],
    searching: false,
  };
}

function resetSearchPanelState(
  state: SearchPanelControllerState,
): SearchPanelControllerState {
  if (
    state.query === "" &&
    state.typeFilter === "" &&
    state.results.length === 0 &&
    !state.searching
  ) {
    return state;
  }
  return DEFAULT_SEARCH_PANEL_CONTROLLER_STATE;
}

export function useSearchPanelController({
  open,
  searchMode,
  searchVersion,
  indexer,
}: UseSearchPanelControllerOptions): SearchPanelController {
  const [state, setState] = useState<SearchPanelControllerState>(
    DEFAULT_SEARCH_PANEL_CONTROLLER_STATE,
  );
  const { query, typeFilter } = state;

  useEffect(() => {
    if (open) {
      return;
    }
    setState((current) => resetSearchPanelState(current));
  }, [open]);

  useEffect(() => {
    if (searchMode !== "source") {
      return;
    }
    setState((current) => (
      current.typeFilter === ""
        ? current
        : {
          ...current,
          typeFilter: "",
        }
    ));
  }, [searchMode]);

  useEffect(() => {
    if (!open || !indexer) {
      setState((current) => clearSearchResults(current));
      return;
    }

    const text = query.trim();
    const type = typeFilter || undefined;
    const isSemanticIdle = searchMode === "semantic" && !text && !type;
    const isSourceIdle = searchMode === "source" && !text;

    if (isSemanticIdle || isSourceIdle) {
      setState((current) => clearSearchResults(current));
      return;
    }

    setState((current) => (
      current.searching
        ? current
        : {
          ...current,
          searching: true,
        }
    ));

    let cancelled = false;

    void (async () => {
      try {
        const results = searchMode === "semantic"
          ? await indexer.query(buildSemanticSearchQuery(text, type))
          : await indexer.querySourceText({ text });
        if (!cancelled) {
          setState((current) => ({
            ...current,
            results,
            searching: false,
          }));
        }
      } catch (_error: unknown) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            results: [],
            searching: false,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
      setState((current) => (
        current.searching
          ? {
            ...current,
            searching: false,
          }
          : current
      ));
    };
  }, [open, query, typeFilter, searchMode, searchVersion, indexer]);

  return {
    ...state,
    setQuery: (nextQuery: string) => {
      setState((current) => (
        current.query === nextQuery
          ? current
          : {
            ...current,
            query: nextQuery,
          }
      ));
    },
    setTypeFilter: (nextTypeFilter: string) => {
      setState((current) => (
        current.typeFilter === nextTypeFilter
          ? current
          : {
            ...current,
            typeFilter: nextTypeFilter,
          }
      ));
    },
  };
}
