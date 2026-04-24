/**
 * CM6 ViewPlugin that feeds search state into widget-backed render surfaces.
 *
 * CM6's built-in search highlighter uses Decoration.mark, which is invisible
 * inside Decoration.replace widgets. Render widgets register their DOM roots
 * with the source-widget layer; this plugin supplies canonical visible search
 * state so widgets can own their highlight classes without data-source DOM
 * queries here.
 */

import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { collectVisibleSearchState } from "../search/search-matches";
import { createSimpleViewPlugin } from "./view-plugin-factories";
import { syncRegisteredWidgetSearchHighlights } from "./source-widget";

function syncHighlights(
  view: EditorView,
  hadHighlights: boolean,
): boolean {
  return syncRegisteredWidgetSearchHighlights(
    view,
    collectVisibleSearchState(view),
    hadHighlights,
  );
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
    hadHighlights = syncHighlights(view, hadHighlights);
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

  return createSimpleViewPlugin(buildFn, {
    shouldUpdate,
    spanName: "cm6.searchHighlights",
  });
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
