import { describe, expect, it, afterEach } from "vitest";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";

import { createTestView } from "../test-utils";
import {
  collectVisibleSearchMatches,
  findReplaceExtension,
  getSearchControllerState,
  openFindSearch,
  openReplaceSearch,
  searchControllerExtensions,
  setSearchControllerQuery,
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
    expect(view.dom.querySelector(".cf-search-panel")).not.toBeNull();
    const replaceRow = view.dom.querySelector<HTMLElement>(".cf-replace-row");
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.style.display).toBe("none");

    openReplaceSearch(view);
    expect(view.dom.querySelector(".cf-search-panel")).not.toBeNull();
    expect(view.dom.querySelector<HTMLElement>(".cf-replace-row")?.style.display).toBe("");
  });
});
