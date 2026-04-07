import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

import { SEARCH_CONTEXT_BUFFER } from "../constants";

export interface SearchMatchRange {
  readonly from: number;
  readonly to: number;
}

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
