import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestView } from "../test-utils";
import {
  coarseHitTestPosition,
  coarseHitTestPositionAndSide,
  domCaretHitTestPosition,
  editorHitTestSnapshot,
  lineBoundsForElement,
  preciseHitTestPosition,
  safePosAtDOM,
} from "./editor-hit-test";

let view: EditorView | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  view?.destroy();
  view = undefined;
});

function makeView(): EditorView {
  view = createTestView("abc\ndef");
  return view;
}

function firstLine(target: EditorView): HTMLElement {
  const line = target.contentDOM.querySelector<HTMLElement>(".cm-line");
  if (!line) throw new Error("expected CM line");
  return line;
}

describe("editor hit testing", () => {
  it("reports precise and coarse coordinate results separately", () => {
    const target = makeView();
    vi.spyOn(target, "posAtCoords").mockImplementation(((point, precise) => {
      expect(point).toEqual({ x: 10, y: 20 });
      return precise === false ? 5 : 1;
    }) as EditorView["posAtCoords"]);

    expect(preciseHitTestPosition(target, { x: 10, y: 20 })).toMatchObject({
      pos: 1,
      line: 1,
      strategy: "precise",
    });
    expect(coarseHitTestPosition(target, { x: 10, y: 20 })).toMatchObject({
      pos: 5,
      line: 2,
      strategy: "coarse",
    });
  });

  it("preserves assoc for coarse line-scoped hit tests", () => {
    const target = makeView();
    vi.spyOn(target, "posAndSideAtCoords").mockReturnValue({ pos: 2, assoc: -1 });

    const hit = coarseHitTestPositionAndSide(
      target,
      { x: 1, y: 2 },
      { from: 0, to: 3, fromLine: 1, toLine: 1 },
    );

    expect(hit).toMatchObject({
      pos: 2,
      assoc: -1,
      line: 1,
      strategy: "coarse",
    });
  });

  it("rejects coarse results outside the requested line bounds", () => {
    const target = makeView();
    vi.spyOn(target, "posAndSideAtCoords").mockReturnValue({ pos: 5, assoc: 1 });

    expect(coarseHitTestPositionAndSide(
      target,
      { x: 1, y: 2 },
      { from: 0, to: 3, fromLine: 1, toLine: 1 },
    )).toBeNull();
  });

  it("wraps posAtDOM failures instead of leaking browser hit-test exceptions", () => {
    const target = makeView();
    const line = firstLine(target);
    vi.spyOn(target, "posAtDOM").mockImplementation(() => {
      throw new Error("not in document");
    });

    expect(safePosAtDOM(target, line, 0)).toBeNull();
    expect(lineBoundsForElement(target, line)).toBeNull();
  });

  it("uses DOM caret hit testing inside the requested owner and clamps to line bounds", () => {
    const target = makeView();
    const line = firstLine(target);
    const textNode = line.firstChild;
    if (!textNode) throw new Error("expected text node");
    vi.spyOn(target, "posAtDOM").mockReturnValue(10);
    Object.defineProperty(target.dom.ownerDocument, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: textNode, offset: 1 }),
    });

    const hit = domCaretHitTestPosition(target, { x: 1, y: 2 }, {
      within: line,
      bounds: { from: 0, to: 3, fromLine: 1, toLine: 1 },
    });

    expect(hit).toMatchObject({
      pos: 3,
      line: 1,
      strategy: "dom-caret",
    });
  });

  it("captures a debug snapshot without collapsing strategy disagreement", () => {
    const target = makeView();
    vi.spyOn(target, "posAtCoords").mockImplementation(((_point, precise) => (
      precise === false ? 5 : 1
    )) as EditorView["posAtCoords"]);

    const snapshot = editorHitTestSnapshot(target, { x: 1, y: 2 }, firstLine(target));

    expect(snapshot.precise?.pos).toBe(1);
    expect(snapshot.coarse?.pos).toBe(5);
    expect(snapshot.lineBounds?.fromLine).toBe(1);
  });
});
