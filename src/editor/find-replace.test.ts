import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { CSS } from "../constants/css-classes";
import { createTestView } from "../test-utils";
import {
  collectVisibleSearchMatches,
  findReplaceExtension,
  getSearchControllerState,
  MAX_CACHED_SEARCH_MATCH_RANGES,
  openFindSearch,
  openReplaceSearch,
  searchControllerExtensions,
  setSearchControllerQuery,
  _updateSearchMatchCacheForTest as updateSearchMatchCache,
} from "./find-replace";

const views: EditorView[] = [];

function createView(doc: string): EditorView {
  const view = createTestView(doc, {
    extensions: [searchControllerExtensions, search({ top: true })],
  });
  views.push(view);
  return view;
}

function createPanelView(doc: string): EditorView {
  const view = createTestView(doc, {
    extensions: [findReplaceExtension],
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

describe("searchController", () => {
  it("tracks find vs replace panel mode in owned state", () => {
    const view = createView("alpha beta alpha");

    openFindSearch(view);
    expect(getSearchControllerState(view).replaceVisible).toBe(false);

    openReplaceSearch(view);
    expect(getSearchControllerState(view).replaceVisible).toBe(true);
  });

  it("counts matches through the shared controller", () => {
    const view = createView("alpha beta alpha");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    const state = getSearchControllerState(view);
    expect(state.total).toBe(2);
  });

  it("exposes visible matches for rich-surface integrations", () => {
    const view = createView("alpha beta alpha");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    expect(collectVisibleSearchMatches(view)).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
  });

  it("renders the Coflat-native panel and toggles the replace row", () => {
    const view = createPanelView("alpha beta alpha");

    openFindSearch(view);
    expect(view.dom.querySelector(`.${CSS.searchPanel}`)).not.toBeNull();
    const replaceRow = view.dom.querySelector<HTMLElement>(`.${CSS.searchReplaceRow}`);
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.style.display).toBe("none");

    openReplaceSearch(view);
    expect(view.dom.querySelector(`.${CSS.searchPanel}`)).not.toBeNull();
    expect(view.dom.querySelector<HTMLElement>(`.${CSS.searchReplaceRow}`)?.style.display).toBe("");
  });

  // Regression: countSearchMatches was called on every ViewUpdate (O(N) per cursor
  // move). The panel update() function now caches counts and skips the scan when
  // doc, selection, and query have not changed. See #346.
  it("countSearchMatches returns consistent results across calls", () => {
    // Use the controller directly — the caching is an internal implementation
    // detail of the panel, but the public API must still return accurate counts.
    const view = createView("alpha beta alpha gamma alpha");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    const state1 = getSearchControllerState(view);
    const state2 = getSearchControllerState(view);
    // Counts must be stable across repeated calls with the same state.
    expect(state1.total).toBe(state2.total);
    expect(state1.total).toBe(3);
  });

  it("reuses cached match ranges for selection-only panel updates", () => {
    const view = createView("alpha beta alpha gamma alpha");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    const initial = updateSearchMatchCache(view, null);
    view.dispatch({ selection: { anchor: 11, head: 16 } });
    const moved = updateSearchMatchCache(view, initial);

    expect(moved.ranges).toBe(initial.ranges);
    expect(moved.total).toBe(3);
    expect(moved.current).toBe(2);
  });

  it("does not retain match range objects for extremely common queries", () => {
    const view = createView("a".repeat(MAX_CACHED_SEARCH_MATCH_RANGES + 1));

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "a",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    const initial = updateSearchMatchCache(view, null);

    expect(initial.total).toBe(MAX_CACHED_SEARCH_MATCH_RANGES + 1);
    expect(initial.ranges).toBeNull();
  });
});
