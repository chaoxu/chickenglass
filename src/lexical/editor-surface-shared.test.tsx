import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { repairBlankClickSelection } from "./editor-surface-shared";

function createMouseEvent(clientX = 0, clientY = 0): ReactMouseEvent {
  return { clientX, clientY } as ReactMouseEvent;
}

function createCollapsedRange(node: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

function expectSelectionToMatch(expected: Range): void {
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  expect(selection?.rangeCount).toBe(1);

  const actual = selection?.getRangeAt(0);
  expect(actual?.compareBoundaryPoints(Range.START_TO_START, expected)).toBe(0);
  expect(actual?.compareBoundaryPoints(Range.END_TO_END, expected)).toBe(0);
}

function setDocumentCaretApis(options: {
  caretRangeFromPoint?: Document["caretRangeFromPoint"];
  caretPositionFromPoint?: Document["caretPositionFromPoint"];
}): void {
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true,
    writable: true,
    value: options.caretRangeFromPoint,
  });
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    writable: true,
    value: options.caretPositionFromPoint,
  });
}

const originalCaretRangeFromPoint = document.caretRangeFromPoint;
const originalCaretPositionFromPoint = document.caretPositionFromPoint;

afterEach(() => {
  setDocumentCaretApis({
    caretRangeFromPoint: originalCaretRangeFromPoint,
    caretPositionFromPoint: originalCaretPositionFromPoint,
  });
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("repairBlankClickSelection", () => {
  it("uses the browser caret range when it lands inside the editor root", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    const text = document.createTextNode("Alpha");
    paragraph.append(text);
    root.append(paragraph);
    document.body.append(root);

    const targetRange = createCollapsedRange(text, 2);
    setDocumentCaretApis({
      caretRangeFromPoint: () => targetRange,
      caretPositionFromPoint: undefined,
    });

    repairBlankClickSelection(root, createMouseEvent(12, 18));

    expectSelectionToMatch(targetRange);
  });

  it("falls back to the end of the editor root when the browser has no caret API", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Alpha</p><p>Beta</p>";
    document.body.append(root);

    const initialRange = createCollapsedRange(root.firstChild ?? root, 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(initialRange);

    setDocumentCaretApis({
      caretRangeFromPoint: undefined,
      caretPositionFromPoint: undefined,
    });

    repairBlankClickSelection(root, createMouseEvent(40, 60));

    const expectedRange = document.createRange();
    expectedRange.selectNodeContents(root);
    expectedRange.collapse(false);
    expectSelectionToMatch(expectedRange);
  });

  it("uses caretPositionFromPoint when caretRangeFromPoint is unavailable", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    const text = document.createTextNode("Gamma");
    paragraph.append(text);
    root.append(paragraph);
    document.body.append(root);

    setDocumentCaretApis({
      caretRangeFromPoint: undefined,
      caretPositionFromPoint: () => ({
        getClientRect: () => null,
        offset: 3,
        offsetNode: text,
      } as CaretPosition),
    });

    repairBlankClickSelection(root, createMouseEvent(24, 10));

    expectSelectionToMatch(createCollapsedRange(text, 3));
  });
});
