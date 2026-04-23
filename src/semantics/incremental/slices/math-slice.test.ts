import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { ensureFullSyntaxTree } from "../../../test-utils";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import { extractStructuralWindow } from "../window-extractor";
import {
  buildMathSlice,
  mapMathRegionUpdate,
  mapMathSemantics,
  mergeMathSlice,
  type DirtyMathWindowExtraction,
  type MathSlice,
} from "./math-slice";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
}

function analyzeMathSlice(state: EditorState): MathSlice {
  const source = editorStateTextSource(state);
  return buildMathSlice(extractStructuralWindow(source, fullTree(state)));
}

function extractDirtyMathWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyMathWindowExtraction[] {
  const source = editorStateTextSource(state);
  const tree = fullTree(state);

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
    const afterSource = editorStateTextSource(tr.state);
    const afterTree = fullTree(tr.state);
    const after = mergeMathSlice(
      before,
      delta,
      extractDirtyMathWindows(tr.state, delta),
      afterSource,
      afterTree,
    );

    expect(after.mathRegions).toHaveLength(3);
    expect(after.mathRegions[0]).toBe(before.mathRegions[0]);
    expect(after.mathRegions[1]).not.toBe(before.mathRegions[1]);
    expect(after.mathRegions[1].latex).toBe("w");
    expect(after.mathRegions[2]).toBe(before.mathRegions[2]);
  });

  it("precomputes mapped and retained math regions for one incremental update", () => {
    const doc = [
      "Alpha $x$.",
      "",
      "Beta $y$.",
      "",
      "Gamma $z$.",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeMathSlice(beforeState);
    const insertAt = doc.indexOf("Beta $y$.") + "Beta ".length;
    const tr = beforeState.update({
      changes: { from: insertAt, insert: "wide " },
    });
    const mapped = mapMathRegionUpdate(before, buildSemanticDelta(tr));

    expect(mapped.all).toHaveLength(3);
    expect(mapped.retained).toHaveLength(2);
    expect(mapped.all[0]).toBe(before.mathRegions[0]);
    expect(mapped.retained[0]).toBe(before.mathRegions[0]);
    expect(mapped.all[1].latex).toBe("y");
    expect(mapped.retained[1].latex).toBe("z");
    expect(mapped.retained[1].from).toBe(before.mathRegions[2].from + "wide ".length);
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
    const afterSource = editorStateTextSource(tr.state);
    const afterTree = fullTree(tr.state);
    const after = mergeMathSlice(
      before,
      delta,
      extractDirtyMathWindows(tr.state, delta),
      afterSource,
      afterTree,
    );

    expect(after).toBe(before);
    expect(after.mathRegions[0]).toBe(before.mathRegions[0]);
    expect(after.mathRegions[1]).toBe(before.mathRegions[1]);
  });

  it("preserves the untouched math prefix when a prose insert shifts only later math", () => {
    const doc = [
      "Alpha $x$.",
      "",
      "Beta paragraph.",
      "",
      "Gamma $y$.",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeMathSlice(beforeState);
    const insertAt = doc.indexOf("Beta paragraph.");
    const tr = beforeState.update({
      changes: { from: insertAt, to: insertAt, insert: "Lead " },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeMathSlice(
      before,
      delta,
      extractDirtyMathWindows(tr.state, delta),
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );

    expect(after.mathRegions[0]).toBe(before.mathRegions[0]);
    expect(after.mathRegions[1]).not.toBe(before.mathRegions[1]);
    expect(after.mathRegions[1].from).toBe(before.mathRegions[1].from + 5);
  });
});
