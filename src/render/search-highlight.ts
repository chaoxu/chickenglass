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

import { type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  collectVisibleSearchMatches,
  getSearchControllerState,
} from "../editor/find-replace";
import { createSimpleViewPlugin } from "./render-utils";

const MATCH_CLASS = "cf-search-match";
const SELECTED_MATCH_CLASS = "cf-search-match-selected";

/**
 * Check whether two ranges overlap.
 * A match overlaps a widget when matchFrom < widgetTo && matchTo > widgetFrom.
 */
function rangesOverlap(
  aFrom: number, aTo: number,
  bFrom: number, bTo: number,
): boolean {
  return aFrom < bTo && aTo > bFrom;
}

/**
 * Walk widget elements in contentDOM and toggle highlight classes
 * based on whether any search match overlaps their source range.
 */
function syncHighlights(view: EditorView, hadHighlights: boolean): boolean {
  const matches = collectVisibleSearchMatches(view);

  // Fast path: no matches and nothing to clear
  if (matches.length === 0 && !hadHighlights) return false;

  const selection = view.state.selection.main;
  const widgets = view.contentDOM.querySelectorAll<HTMLElement>("[data-source-from]");
  let anyHighlighted = false;

  for (const el of widgets) {
    const sourceFrom = Number(el.dataset.sourceFrom);
    const sourceTo = Number(el.dataset.sourceTo);
    if (Number.isNaN(sourceFrom) || Number.isNaN(sourceTo)) {
      el.classList.remove(MATCH_CLASS, SELECTED_MATCH_CLASS);
      continue;
    }

    let hasMatch = false;
    let hasSelectedMatch = false;

    for (const match of matches) {
      if (rangesOverlap(match.from, match.to, sourceFrom, sourceTo)) {
        hasMatch = true;
        if (selection.from === match.from && selection.to === match.to) {
          hasSelectedMatch = true;
          break;
        }
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
    hadHighlights = syncHighlights(view, hadHighlights);
    return Decoration.none;
  }

  function shouldUpdate(update: ViewUpdate): boolean {
    const controller = getSearchControllerState(update.view);
    const searchStr = controller.query.valid ? controller.query.search : "";
    const panelOpen = controller.panelOpen;

    const searchChanged = searchStr !== lastSearch || panelOpen !== lastPanelOpen;
    if (
      searchChanged ||
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged
    ) {
      lastSearch = searchStr;
      lastPanelOpen = panelOpen;
      return true;
    }
    return false;
  }

  return createSimpleViewPlugin(buildFn, { shouldUpdate });
}

/** CM6 extension that highlights search matches inside widget-backed content. */
export const searchHighlightPlugin: Extension = createSearchHighlight();
