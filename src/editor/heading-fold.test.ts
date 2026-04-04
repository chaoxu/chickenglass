import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { codeFolding, foldEffect, foldService } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { createTestView } from "../test-utils";
import { headingFold } from "./heading-fold";

function getFoldRange(
  view: EditorView,
  lineNumber: number,
): { from: number; to: number } | null {
  const line = view.state.doc.line(lineNumber);
  for (const service of view.state.facet(foldService)) {
    const range = service(view.state, line.from, line.to);
    if (range) {
      return range;
    }
  }
  return null;
}

function getFoldToggles(view: EditorView): HTMLElement[] {
  return [...view.dom.querySelectorAll<HTMLElement>(".cf-fold-toggle")];
}

describe("headingFold", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("folds headings until the next heading of equal or higher level", () => {
    const doc = [
      "# One",
      "intro",
      "## Two",
      "two body",
      "### Three",
      "three body",
      "## Four",
      "four body",
      "# Five",
      "tail",
    ].join("\n");

    view = createTestView(doc, {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    expect(getFoldRange(view, 1)).toEqual({
      from: view.state.doc.line(1).to,
      to: view.state.doc.line(9).from - 1,
    });
    expect(getFoldRange(view, 3)).toEqual({
      from: view.state.doc.line(3).to,
      to: view.state.doc.line(7).from - 1,
    });
    expect(getFoldRange(view, 5)).toEqual({
      from: view.state.doc.line(5).to,
      to: view.state.doc.line(7).from - 1,
    });
    expect(getFoldRange(view, 9)).toEqual({
      from: view.state.doc.line(9).to,
      to: view.state.doc.length,
    });
  });

  it("updates last-heading foldability when trailing content is inserted or removed", () => {
    view = createTestView("# Last", {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    expect(getFoldRange(view, 1)).toBeNull();
    expect(getFoldToggles(view)).toHaveLength(0);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nBody" },
    });

    expect(getFoldRange(view, 1)).toEqual({
      from: view.state.doc.line(1).to,
      to: view.state.doc.length,
    });
    expect(getFoldToggles(view)).toHaveLength(1);

    view.dispatch({
      changes: { from: view.state.doc.line(1).to, to: view.state.doc.length },
    });

    expect(getFoldRange(view, 1)).toBeNull();
    expect(getFoldToggles(view)).toHaveLength(0);
  });

  it("updates the inline toggle when a heading is folded", () => {
    view = createTestView("# Fold\nBody", {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    const range = getFoldRange(view, 1);
    expect(range).not.toBeNull();
    expect(getFoldToggles(view)[0]?.textContent).toBe("▼");

    if (!range) {
      throw new Error("expected a foldable heading range");
    }

    view.dispatch({ effects: foldEffect.of(range) });

    const toggle = getFoldToggles(view)[0];
    expect(toggle?.classList.contains("cf-fold-toggle-folded")).toBe(true);
    expect(toggle?.textContent).toBe("▶");
  });
});
