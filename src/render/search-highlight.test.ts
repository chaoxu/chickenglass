import { afterEach, describe, expect, it } from "vitest";
import type { Extension } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { search } from "@codemirror/search";

import { createTestView } from "../test-utils";
// Direct import: barrel would create circular dependency (render/index → search-highlight → editor/index → ... → render/index)
import {
  nextSearchMatch,
  openFindSearch,
  searchControllerExtensions,
  setSearchControllerQuery,
} from "../editor/find-replace";
import { MathWidget } from "./math-render";
import { searchHighlightPlugin } from "./search-highlight";

const views: EditorView[] = [];

class FakeSearchWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cf-fake-search-widget";
    el.dataset.sourceFrom = "0";
    el.dataset.sourceTo = "5";
    el.textContent = "alpha";
    return el;
  }
}

function createSearchView(doc: string, extensions: readonly Extension[] = []): EditorView {
  const view = createTestView(doc, {
    extensions: [
      searchControllerExtensions,
      search({ top: true }),
      searchHighlightPlugin,
      ...extensions,
    ],
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

describe("searchHighlightPlugin", () => {
  it("highlights generic widget-backed matches via data-source metadata", () => {
    const widgetDeco = EditorView.decorations.of(
      Decoration.set([
        Decoration.replace({ widget: new FakeSearchWidget() }).range(0, 5),
      ]),
    );
    const view = createSearchView("alpha beta", [widgetDeco]);

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "alpha",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });

    const widget = view.contentDOM.querySelector(".cf-fake-search-widget");
    expect(widget?.classList.contains(CSS.searchMatch)).toBe(true);
  });

  it("marks rendered math widgets as selected when the current match lands inside them", () => {
    const mathWidget = new MathWidget("x^2", "$x^2$", false, {});
    mathWidget.sourceFrom = 7;
    mathWidget.sourceTo = 12;
    const mathDeco = EditorView.decorations.of(
      Decoration.set([
        Decoration.replace({ widget: mathWidget }).range(7, 12),
      ]),
    );
    const view = createSearchView("Before x^2 after", [mathDeco]);

    openFindSearch(view);
    setSearchControllerQuery(view, {
      search: "x^2",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });
    nextSearchMatch(view);

    const math = view.contentDOM.querySelector(`.${CSS.mathInline}`);
    expect(math?.classList.contains(CSS.searchMatch)).toBe(true);
    expect(math?.classList.contains(CSS.searchMatchSelected)).toBe(true);
  });
});
