import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  computeInlineMathViewportRanges,
  INLINE_MATH_VIEWPORT_MARGIN_LINES,
} from "./math-inline-viewport";

describe("computeInlineMathViewportRanges", () => {
  it("expands visible ranges by a bounded line margin instead of the full document", () => {
    const doc = Array.from(
      { length: 500 },
      (_, index) => `line ${index + 1} $x_${index + 1}$`,
    ).join("\n");
    const state = EditorState.create({ doc });
    const visibleLine = state.doc.line(250);
    const view = {
      state,
      visibleRanges: [{ from: visibleLine.from, to: visibleLine.to }],
    } as unknown as EditorView;

    const [range] = computeInlineMathViewportRanges(view);

    expect(range).toEqual({
      from: state.doc.line(250 - INLINE_MATH_VIEWPORT_MARGIN_LINES).from,
      to: state.doc.line(250 + INLINE_MATH_VIEWPORT_MARGIN_LINES).to,
    });
    expect(range.from).toBeGreaterThan(0);
    expect(range.to).toBeLessThan(state.doc.length);
  });
});
