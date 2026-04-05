import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldService,
} from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { createTestView } from "../test-utils";
import {
  _headingFoldFieldForTest as headingFoldField,
  headingFold,
} from "./heading-fold";

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

function getFoldState(view: EditorView) {
  return view.state.field(headingFoldField);
}

function isRangeFolded(
  view: EditorView,
  range: { from: number; to: number },
): boolean {
  let folded = false;
  foldedRanges(view.state).between(range.from, range.from + 1, () => {
    folded = true;
  });
  return folded;
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

  it("reuses the existing fold state when body edits do not move headings", () => {
    const doc = [
      "# One",
      "body",
      "# Two",
      "tail",
    ].join("\n");

    view = createTestView(doc, {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    const before = getFoldState(view);
    const replaceFrom = doc.indexOf("body");
    view.dispatch({
      changes: { from: replaceFrom, to: replaceFrom + 4, insert: "text" },
    });

    expect(getFoldState(view)).toBe(before);
  });

  it("reuses unaffected prefix sections when body edits only move a later suffix", () => {
    const doc = [
      "# One",
      "one body",
      "# Two",
      "two body",
      "## Three",
      "three body",
      "# Four",
      "four body",
    ].join("\n");

    view = createTestView(doc, {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    const before = getFoldState(view);
    view.dispatch({
      changes: { from: doc.indexOf("## Three"), insert: "two extra\n" },
    });
    const after = getFoldState(view);

    expect(after.sectionsByHeadingIndex[0]).toBe(before.sectionsByHeadingIndex[0]);
    expect(after.sectionsByHeadingIndex[1]).not.toBe(before.sectionsByHeadingIndex[1]);
    expect(after.sectionsByHeadingIndex[2]).not.toBe(before.sectionsByHeadingIndex[2]);
    expect(after.sectionsByHeadingIndex[3]).not.toBe(before.sectionsByHeadingIndex[3]);
  });

  it("keeps moved fold toggles targeting the updated heading position", () => {
    const doc = [
      "# One",
      "one body",
      "# Two",
      "two body",
    ].join("\n");

    view = createTestView(doc, {
      extensions: [markdown(), codeFolding(), headingFold],
    });

    view.dispatch({
      changes: { from: doc.indexOf("# Two"), insert: "lead\n" },
    });

    const range = getFoldRange(view, 4);
    expect(range).toEqual({
      from: view.state.doc.line(4).to,
      to: view.state.doc.length,
    });

    if (!range) {
      throw new Error("expected moved heading to stay foldable");
    }

    getFoldToggles(view)[1]?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(isRangeFolded(view, range)).toBe(true);
    expect(getFoldToggles(view)[1]?.textContent).toBe("▶");
  });
});
