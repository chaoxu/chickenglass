import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

import { SEARCH_CONTEXT_BUFFER } from "../constants";

export interface SearchMatchRange {
  readonly from: number;
  readonly to: number;
}

export interface VisibleSearchState {
  readonly matches: ReadonlyArray<SearchMatchRange>;
  readonly activeMatch: SearchMatchRange | null;
}

const EMPTY_VISIBLE_SEARCH_STATE: VisibleSearchState = {
  matches: [],
  activeMatch: null,
};

export function collectVisibleSearchMatches(view: EditorView): SearchMatchRange[] {
  if (!searchPanelOpen(view.state)) return [];

  const spec = getSearchQuery(view.state);
  if (!spec.valid) return [];

  const matches: SearchMatchRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    const searchFrom = Math.max(0, from - SEARCH_CONTEXT_BUFFER);
    const searchTo = Math.min(view.state.doc.length, to + SEARCH_CONTEXT_BUFFER);
    const cursor = spec.getCursor(view.state.doc, searchFrom, searchTo);
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      matches.push({ from: result.value.from, to: result.value.to });
    }
  }
  return matches;
}

export function collectVisibleSearchState(view: EditorView): VisibleSearchState {
  const matches = collectVisibleSearchMatches(view)
    .slice()
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (matches.length === 0) {
    return EMPTY_VISIBLE_SEARCH_STATE;
  }

  const selection = view.state.selection.main;
  const activeMatch = matches.find((match) => (
    selection.from === match.from && selection.to === match.to
  )) ?? null;

  return {
    matches,
    activeMatch,
  };
}
