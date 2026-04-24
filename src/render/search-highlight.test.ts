import { afterEach, describe, expect, it, vi } from "vitest";
import { StateField, type Extension } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { search } from "@codemirror/search";

import { createTestView } from "../test-utils";
import {
  nextSearchMatch,
  openFindSearch,
  searchControllerExtensions,
  setSearchControllerQuery,
} from "../editor/find-replace";
import {
  MathWidget,
  searchHighlightPlugin,
  shouldUpdateSearchHighlights,
} from ".";
import { RenderWidget } from "./source-widget";

const views: EditorView[] = [];

class FakeSearchWidget extends RenderWidget {
  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cf-fake-search-widget";
    el.textContent = "alpha";
    return el;
  }

  eq(other: WidgetType): boolean {
    return other instanceof FakeSearchWidget;
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

function createMappedFakeWidgetExtension(widget: WidgetType): Extension {
  return StateField.define({
    create() {
      return Decoration.set([
        Decoration.replace({ widget }).range(0, 5),
      ]);
    },
    update(value, tr) {
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

describe("searchHighlightPlugin", () => {
  it("skips updates while search is inactive and there are no widget highlights to clear", () => {
    expect(shouldUpdateSearchHighlights(
      {
        docChanged: true,
        selectionSet: true,
        viewportChanged: true,
      },
      {
        lastSearch: "",
        lastPanelOpen: false,
        hadHighlights: false,
      },
      "",
      false,
    )).toBe(false);
  });

  it("highlights generic widget-backed matches via data-source metadata", () => {
    const widgetDeco = EditorView.decorations.of(
      Decoration.set([
        Decoration.replace({
          widget: Object.assign(new FakeSearchWidget(), {
            sourceFrom: 0,
            sourceTo: 5,
          }),
        }).range(0, 5),
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

  it("keeps registered widget highlights through document changes without data-source DOM queries", () => {
    const fakeWidget = new FakeSearchWidget();
    fakeWidget.sourceFrom = 0;
    fakeWidget.sourceTo = 5;
    const widgetDeco = createMappedFakeWidgetExtension(fakeWidget);
    const view = createSearchView("alpha beta", [widgetDeco]);

    openFindSearch(view);
    const querySelectorAllSpy = vi.spyOn(view.contentDOM, "querySelectorAll")
      .mockImplementation(() => {
        throw new Error("search highlight should use registered widgets");
      });

    expect(() => {
      setSearchControllerQuery(view, {
        search: "alpha",
        replace: "",
        caseSensitive: false,
        regexp: false,
        wholeWord: false,
      });
      view.dispatch({ changes: { from: view.state.doc.length, insert: " suffix" } });
    }).not.toThrow();

    querySelectorAllSpy.mockRestore();
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
