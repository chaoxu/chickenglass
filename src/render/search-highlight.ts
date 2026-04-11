/**
 * CM6 ViewPlugin that highlights search matches inside widget-backed content.
 *
 * CM6's built-in search highlighter uses Decoration.mark, which is invisible
 * inside Decoration.replace widgets. This plugin monitors the search query
 * state and walks widget DOM elements to toggle a `cf-search-match` CSS class
 * when a search match overlaps the widget's source range.
 *
 * Works with all RenderWidget subclasses that set data-source-from and
 * data-source-to attributes (math, citations, crossrefs, block headers, etc.).
 */

import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { collectVisibleSearchState, type VisibleSearchState } from "../search/search-matches";
import { createSimpleViewPlugin } from "./view-plugin-factories";
import { resolveLiveWidgetSourceRange } from "./source-widget";

const MATCH_CLASS = "cf-search-match";
const SELECTED_MATCH_CLASS = "cf-search-match-selected";

/**
 * Find the index of the first element in a sorted array whose `to` value
 * is greater than `target`, using binary search.
 */
function lowerBound(
  matches: readonly { from: number; to: number }[],
  target: number,
): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (matches[mid].to <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Walk widget elements in contentDOM and toggle highlight classes
 * based on whether any search match overlaps their source range.
 *
 * Uses binary search on sorted matches to find overlapping ranges
 * in O(widgets * log(matches)) instead of O(widgets * matches).
 */
function syncHighlights(
  view: EditorView,
  searchState: VisibleSearchState,
  hadHighlights: boolean,
): boolean {
  const { matches, activeMatch } = searchState;

  // Fast path: no matches and nothing to clear — skip DOM query entirely (#6)
  if (matches.length === 0 && !hadHighlights) return false;

  // Short-circuit DOM query when no matches but we need to clear previous highlights
  if (matches.length === 0) {
    const widgets = view.contentDOM.querySelectorAll<HTMLElement>(
      `.${MATCH_CLASS},.${SELECTED_MATCH_CLASS}`,
    );
    for (const el of widgets) {
      el.classList.remove(MATCH_CLASS, SELECTED_MATCH_CLASS);
    }
    return false;
  }

  const widgets = view.contentDOM.querySelectorAll<HTMLElement>("[data-source-from]");
  let anyHighlighted = false;

  for (const el of widgets) {
    const sourceRange = resolveLiveWidgetSourceRange(view, el);
    if (!sourceRange) {
      el.classList.remove(MATCH_CLASS, SELECTED_MATCH_CLASS);
      continue;
    }
    const { from: sourceFrom, to: sourceTo } = sourceRange;

    const hasSelectedMatch =
      activeMatch !== null &&
      activeMatch.from < sourceTo &&
      activeMatch.to > sourceFrom;
    let hasMatch = hasSelectedMatch;

    if (!hasMatch) {
      // Binary search: find first match whose `to` > sourceFrom,
      // then scan forward while match.from < sourceTo.
      const startIdx = lowerBound(matches, sourceFrom);
      for (let i = startIdx; i < matches.length; i++) {
        const match = matches[i];
        if (match.from >= sourceTo) break; // no more overlaps possible
        hasMatch = true;
        break;
      }
    }

    el.classList.toggle(MATCH_CLASS, hasMatch);
    el.classList.toggle(SELECTED_MATCH_CLASS, hasSelectedMatch);
    if (hasMatch) anyHighlighted = true;
  }

  return anyHighlighted;
}

/**
 * Create the search-highlight extension using closure state for
 * cross-update tracking (lastSearch, lastPanelOpen, hadHighlights).
 */
function createSearchHighlight(): Extension {
  let lastSearch = "";
  let lastPanelOpen = false;
  let hadHighlights = false;

  function buildFn(view: EditorView): DecorationSet {
    hadHighlights = syncHighlights(view, collectVisibleSearchState(view), hadHighlights);
    return Decoration.none;
  }

  function shouldUpdate(update: ViewUpdate): boolean {
    // Read query and panel state directly via O(1) state field lookups
    // instead of getSearchControllerState which calls countSearchMatches (O(N)).
    const query = getSearchQuery(update.state);
    const searchStr = query.valid ? query.search : "";
    const panelOpen = searchPanelOpen(update.state);
    const result = shouldUpdateSearchHighlights(
      update,
      {
        lastSearch,
        lastPanelOpen,
        hadHighlights,
      },
      searchStr,
      panelOpen,
    );
    lastSearch = searchStr;
    lastPanelOpen = panelOpen;
    return result;
  }

  return createSimpleViewPlugin(buildFn, { shouldUpdate });
}

interface SearchHighlightUpdateState {
  readonly lastSearch: string;
  readonly lastPanelOpen: boolean;
  readonly hadHighlights: boolean;
}

export function shouldUpdateSearchHighlights(
  update: Pick<ViewUpdate, "docChanged" | "selectionSet" | "viewportChanged">,
  previous: SearchHighlightUpdateState,
  searchStr: string,
  panelOpen: boolean,
): boolean {
  const searchChanged =
    searchStr !== previous.lastSearch || panelOpen !== previous.lastPanelOpen;
  if (searchChanged) {
    return true;
  }

  if (searchStr.length === 0 && !panelOpen && !previous.hadHighlights) {
    return false;
  }

  return update.docChanged || update.selectionSet || update.viewportChanged;
}

/** CM6 extension that highlights search matches inside widget-backed content. */
export const searchHighlightPlugin: Extension = createSearchHighlight();
