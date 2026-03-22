import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface SearchUiState {
  readonly replaceVisible: boolean;
}

export interface SearchControllerState extends SearchUiState {
  readonly panelOpen: boolean;
  readonly query: SearchQuery;
  readonly current: number;
  readonly total: number;
}

export interface SearchMatchRange {
  readonly from: number;
  readonly to: number;
}

const DEFAULT_SEARCH_UI_STATE: SearchUiState = {
  replaceVisible: false,
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
  const query = getSearchQuery(view.state);
  if (!query.valid) return { current: 0, total: 0 };

  const cursor = query.getCursor(view.state);
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;

  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (result.value.from === sel.from && result.value.to === sel.to) {
      current = total;
    }
  }

  return { current, total };
}

export function collectVisibleSearchMatches(view: EditorView): SearchMatchRange[] {
  if (!searchPanelOpen(view.state)) return [];

  const spec = getSearchQuery(view.state);
  if (!spec.valid) return [];

  const matches: SearchMatchRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    const searchFrom = Math.max(0, from - 500);
    const searchTo = Math.min(view.state.doc.length, to + 500);
    const cursor = spec.getCursor(view.state.doc, searchFrom, searchTo);
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      matches.push({ from: result.value.from, to: result.value.to });
    }
  }
  return matches;
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
