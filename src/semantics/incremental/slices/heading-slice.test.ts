import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import { extractStructuralWindow } from "../window-extractor";
import {
  buildHeadingSlice,
  mapHeadingSemantics,
  mergeHeadingSlice,
  type DirtyHeadingWindowExtraction,
  type HeadingSlice,
} from "./heading-slice";

function createState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function fullTree(state: EditorState) {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return syntaxTree(state);
}

function analyzeHeadingSlice(state: EditorState): HeadingSlice {
  const source = editorStateTextSource(state);
  return buildHeadingSlice(extractStructuralWindow(source, fullTree(state)));
}

function extractDirtyHeadingWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyHeadingWindowExtraction[] {
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

describe("heading slice", () => {
  it("maps unchanged heading offsets through transaction changes", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
    ].join("\n");
    const state = createState(doc);
    const before = analyzeHeadingSlice(state);
    const methods = before.headings[1];
    const insert = "Lead paragraph.\n\n";
    const insertAt = doc.indexOf("## Methods");
    const tr = state.update({
      changes: { from: insertAt, insert },
    });

    const mapped = mapHeadingSemantics(methods, tr.changes);

    expect(mapped).toEqual({
      ...methods,
      from: methods.from + insert.length,
      to: methods.to + insert.length,
    });
    expect(mapped).not.toBe(methods);
  });

  it("preserves the unaffected prefix while renumbering the heading tail", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
      "",
      "## Results",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeHeadingSlice(beforeState);
    const stablePrefix = before.headings[0];
    const renumberedTail = before.headings[1];
    const tr = beforeState.update({
      changes: {
        from: doc.indexOf("## Methods"),
        insert: "## Background\n\n",
      },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeHeadingSlice(
      before,
      delta,
      extractDirtyHeadingWindows(tr.state, delta),
    );

    expect(after.headings.map((heading) => ({
      text: heading.text,
      number: heading.number,
    }))).toEqual([
      { text: "Intro", number: "1" },
      { text: "Background", number: "1.1" },
      { text: "Methods", number: "1.2" },
      { text: "Results", number: "1.3" },
    ]);
    expect(after.headings[0]).toBe(stablePrefix);
    expect(after.headings[2]).not.toBe(renumberedTail);
    expect(after.headingByFrom.get(after.headings[2].from)).toBe(after.headings[2]);
  });

  it("evicts a stale mapped heading when an edit starts at heading.from", () => {
    const doc = [
      "# A",
      "",
      "# B",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeHeadingSlice(beforeState);
    const tr = beforeState.update({
      changes: { from: 0, insert: "#" },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeHeadingSlice(
      before,
      delta,
      extractDirtyHeadingWindows(tr.state, delta),
    );

    expect(after.headings.map((heading) => ({
      level: heading.level,
      text: heading.text,
      number: heading.number,
    }))).toEqual([
      { level: 2, text: "A", number: "0.1" },
      { level: 1, text: "B", number: "1" },
    ]);
  });

  it("evicts a stale mapped heading when deleting at heading.from", () => {
    const doc = [
      "## A",
      "",
      "# B",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeHeadingSlice(beforeState);
    const tr = beforeState.update({
      changes: { from: 0, to: 1 },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeHeadingSlice(
      before,
      delta,
      extractDirtyHeadingWindows(tr.state, delta),
    );

    expect(after.headings.map((heading) => ({
      level: heading.level,
      text: heading.text,
      number: heading.number,
    }))).toEqual([
      { level: 1, text: "A", number: "1" },
      { level: 1, text: "B", number: "2" },
    ]);
  });

  it("returns the prior slice when edits land after the heading tail", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
      "",
      "Body.",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeHeadingSlice(beforeState);
    const tr = beforeState.update({
      changes: { from: beforeState.doc.length, insert: "Tail paragraph.\n" },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeHeadingSlice(
      before,
      delta,
      extractDirtyHeadingWindows(tr.state, delta),
    );

    expect(after).toBe(before);
    expect(after.headings[0]).toBe(before.headings[0]);
    expect(after.headings[1]).toBe(before.headings[1]);
  });

  it("preserves zero-valued counters when edits orphan a heading subtree", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
      "",
      "### Details",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeHeadingSlice(beforeState);
    const tr = beforeState.update({
      changes: { from: 0, to: doc.indexOf("## Methods") },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeHeadingSlice(
      before,
      delta,
      extractDirtyHeadingWindows(tr.state, delta),
    );

    expect(after.headings.map((heading) => ({
      level: heading.level,
      text: heading.text,
      number: heading.number,
    }))).toEqual([
      { level: 2, text: "Methods", number: "0.1" },
      { level: 3, text: "Details", number: "0.1.1" },
    ]);
  });
});
