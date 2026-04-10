import { afterEach, describe, expect, it } from "vitest";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { createTestView } from "../test-utils";
import {
  nextSearchMatch,
  openFindSearch,
  searchControllerExtensions,
  setSearchControllerQuery,
} from "../editor/find-replace";
import { collectVisibleSearchState } from "./search-matches";

const views: EditorView[] = [];

function createView(doc: string): EditorView {
  const view = createTestView(doc, {
    extensions: [searchControllerExtensions, search({ top: true })],
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

describe("collectVisibleSearchState", () => {
  it("returns visible matches in document order", () => {
    const view = createView("alpha beta alpha");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    expect(collectVisibleSearchState(view).matches).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
  });

  it("exposes the active visible match separately from the match list", () => {
    const view = createView("alpha beta");

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });
    nextSearchMatch(view);

    expect(collectVisibleSearchState(view)).toEqual({
      matches: [{ from: 0, to: 5 }],
      activeMatch: { from: 0, to: 5 },
    });
  });
});
