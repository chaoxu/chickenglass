import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { editorStateTextSource } from "../../codemirror-source";
import { buildSemanticDelta } from "../semantic-delta";
import { extractStructuralWindow } from "../window-extractor";
import {
  buildMathSlice,
  mapMathSemantics,
  mergeMathSlice,
  type DirtyMathWindowExtraction,
  type MathSlice,
} from "./math-slice";

function createState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function analyzeMathSlice(state: EditorState): MathSlice {
  const source = editorStateTextSource(state);
  return buildMathSlice(extractStructuralWindow(source, syntaxTree(state)));
}

function extractDirtyMathWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyMathWindowExtraction[] {
  const source = editorStateTextSource(state);
  const tree = syntaxTree(state);

  return delta.dirtyWindows.map((window) => ({
    window,
    structural: extractStructuralWindow(source, tree, {
      from: window.fromNew,
      to: window.toNew,
    }),
  }));
}

describe("math slice", () => {
  it("maps unchanged math region offsets through transaction changes", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
    ].join("\n");
    const state = createState(doc);
    const before = analyzeMathSlice(state);
    const second = before.mathRegions[1];
    const insert = "Lead paragraph.\n\n";
    const insertAt = doc.indexOf("$$y$$");
    const tr = state.update({
      changes: { from: insertAt, insert },
    });

    const mapped = mapMathSemantics(second, tr.changes);

    expect(mapped).toEqual({
      ...second,
      from: second.from + insert.length,
      to: second.to + insert.length,
      contentFrom: second.contentFrom + insert.length,
      contentTo: second.contentTo + insert.length,
      labelFrom: (second.labelFrom ?? 0) + insert.length,
    });
    expect(mapped).not.toBe(second);
  });

  it("replaces only the edited math region inside a dirty window", () => {
    const doc = [
      "Alpha $x$.",
      "",
      "Beta $y$.",
      "",
      "Gamma $z$.",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeMathSlice(beforeState);
    const tr = beforeState.update({
      changes: {
        from: doc.indexOf("$y$") + 1,
        to: doc.indexOf("$y$") + 2,
        insert: "w",
      },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeMathSlice(
      before,
      delta,
      extractDirtyMathWindows(tr.state, delta),
    );

    expect(after.mathRegions).toHaveLength(3);
    expect(after.mathRegions[0]).toBe(before.mathRegions[0]);
    expect(after.mathRegions[1]).not.toBe(before.mathRegions[1]);
    expect(after.mathRegions[1].latex).toBe("w");
    expect(after.mathRegions[2]).toBe(before.mathRegions[2]);
  });

  it("preserves untouched math identities across unrelated edits", () => {
    const doc = [
      "Alpha $x$.",
      "",
      "Omega $y$.",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeMathSlice(beforeState);
    const tr = beforeState.update({
      changes: { from: beforeState.doc.length, insert: "\n\nTail paragraph." },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeMathSlice(
      before,
      delta,
      extractDirtyMathWindows(tr.state, delta),
    );

    expect(after).toBe(before);
    expect(after.mathRegions[0]).toBe(before.mathRegions[0]);
    expect(after.mathRegions[1]).toBe(before.mathRegions[1]);
  });
});
