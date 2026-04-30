import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface SearchUiState {
  readonly replaceVisible: boolean;
  /** Persisted toggle state so options survive panel close/reopen. */
  readonly caseSensitive: boolean;
  readonly isRegexp: boolean;
  readonly wholeWord: boolean;
}

export interface SearchControllerState extends SearchUiState {
  readonly panelOpen: boolean;
  readonly query: SearchQuery;
  readonly current: number;
  readonly total: number;
}

export interface SearchMatchSpan {
  readonly from: number;
  readonly to: number;
}

export const MAX_CACHED_SEARCH_MATCH_RANGES = 10_000;

const DEFAULT_SEARCH_UI_STATE: SearchUiState = {
  replaceVisible: false,
  caseSensitive: false,
  isRegexp: false,
  wholeWord: false,
};

export const setSearchUiStateEffect = StateEffect.define<Partial<SearchUiState>>();

export const searchUiStateField = StateField.define<SearchUiState>({
  create() {
    return DEFAULT_SEARCH_UI_STATE;
  },
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setSearchUiStateEffect)) {
        next = { ...next, ...effect.value };
      }
    }
    return next;
  },
});

export const searchControllerExtensions: Extension = [searchUiStateField];

export function countSearchMatches(
  view: EditorView,
): { current: number; total: number } {
  return collectSearchMatchSummary(view);
}

function collectSearchMatchSummary(
  view: EditorView,
): { current: number; total: number; ranges: readonly SearchMatchSpan[] | null } {
  const query = getSearchQuery(view.state);
  if (!query.valid) return { current: 0, total: 0, ranges: [] };

  const cursor = query.getCursor(view.state);
  const sel = view.state.selection.main;
  const ranges: SearchMatchSpan[] = [];
  let cacheRanges = true;
  let total = 0;
  let current = 0;

  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (cacheRanges) {
      if (ranges.length < MAX_CACHED_SEARCH_MATCH_RANGES) {
        ranges.push({ from: result.value.from, to: result.value.to });
      } else {
        ranges.length = 0;
        cacheRanges = false;
      }
    }
    if (result.value.from === sel.from && result.value.to === sel.to) {
      current = total;
    }
  }

  return { current, total, ranges: cacheRanges ? ranges : null };
}

function findMatchOrdinal(
  ranges: readonly SearchMatchSpan[],
  selected: SearchMatchSpan,
): number {
  let low = 0;
  let high = ranges.length - 1;
  let firstCandidate = ranges.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ranges[mid].from >= selected.from) {
      firstCandidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  for (
    let index = firstCandidate;
    index < ranges.length && ranges[index].from === selected.from;
    index += 1
  ) {
    if (ranges[index].to === selected.to) return index + 1;
  }

  return 0;
}

export function getSearchControllerState(view: EditorView): SearchControllerState {
  const ui = view.state.field(searchUiStateField);
  const matches = countSearchMatches(view);
  return {
    ...ui,
    panelOpen: searchPanelOpen(view.state),
    query: getSearchQuery(view.state),
    current: matches.current,
    total: matches.total,
  };
}

export function setSearchUiState(
  view: EditorView,
  next: Partial<SearchUiState>,
): void {
  view.dispatch({
    effects: setSearchUiStateEffect.of(next),
  });
}

export function setSearchControllerQuery(
  view: EditorView,
  next: {
    readonly search: string;
    readonly replace: string;
    readonly caseSensitive: boolean;
    readonly regexp: boolean;
    readonly wholeWord: boolean;
  },
): void {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: next.search,
        replace: next.replace,
        caseSensitive: next.caseSensitive,
        regexp: next.regexp,
        wholeWord: next.wholeWord,
      }),
    ),
  });
}

export function openFindSearch(view: EditorView): boolean {
  setSearchUiState(view, { replaceVisible: false });
  openSearchPanel(view);
  return true;
}

export function openReplaceSearch(view: EditorView): boolean {
  setSearchUiState(view, { replaceVisible: true });
  openSearchPanel(view);
  return true;
}

export function closeSearch(view: EditorView): boolean {
  closeSearchPanel(view);
  return true;
}

export function nextSearchMatch(view: EditorView): void {
  findNext(view);
}

export function previousSearchMatch(view: EditorView): void {
  findPrevious(view);
}

export function replaceCurrentSearchMatch(view: EditorView): void {
  replaceNext(view);
}

export function replaceAllSearchMatches(view: EditorView): void {
  replaceAll(view);
}

/** Reference-identity cache to avoid rescanning on every ViewUpdate. */
export interface SearchMatchCacheSnapshot {
  /** CM6 Text object from state.doc - used for reference equality. */
  readonly doc: Text;
  readonly selFrom: number;
  readonly selTo: number;
  readonly query: SearchQuery;
  readonly current: number;
  readonly total: number;
  readonly ranges: readonly SearchMatchSpan[] | null;
}

function searchQueriesMatchEqual(left: SearchQuery, right: SearchQuery): boolean {
  return left.search === right.search &&
    left.caseSensitive === right.caseSensitive &&
    left.literal === right.literal &&
    left.regexp === right.regexp &&
    left.wholeWord === right.wholeWord &&
    left.test === right.test;
}

export function updateSearchMatchCache(
  view: EditorView,
  cache: SearchMatchCacheSnapshot | null,
): SearchMatchCacheSnapshot {
  const state = view.state;
  const q = getSearchQuery(state);
  const sel = state.selection.main;

  if (
    cache === null ||
    cache.doc !== state.doc ||
    !searchQueriesMatchEqual(cache.query, q)
  ) {
    const { current, total, ranges } = collectSearchMatchSummary(view);
    return {
      doc: state.doc,
      selFrom: sel.from,
      selTo: sel.to,
      query: q,
      current,
      total,
      ranges,
    };
  }

  if (cache.selFrom === sel.from && cache.selTo === sel.to) {
    return cache;
  }

  if (cache.ranges === null) {
    const { current, total, ranges } = collectSearchMatchSummary(view);
    return {
      ...cache,
      selFrom: sel.from,
      selTo: sel.to,
      current,
      total,
      ranges,
    };
  }

  return {
    ...cache,
    selFrom: sel.from,
    selTo: sel.to,
    current: findMatchOrdinal(cache.ranges, {
      from: sel.from,
      to: sel.to,
    }),
  };
}
