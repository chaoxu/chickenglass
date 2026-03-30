import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { editorStateTextSource } from "../../codemirror-source";
import { buildSemanticDelta } from "../semantic-delta";
import { extractStructuralWindow } from "../window-extractor";
import {
  buildFootnoteSlice,
  mergeFootnoteSlice,
  type DirtyFootnoteWindowExtraction,
  type FootnoteSlice,
} from "./footnote-slice";

function createState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function analyzeFootnoteSlice(state: EditorState): FootnoteSlice {
  const source = editorStateTextSource(state);
  return buildFootnoteSlice(extractStructuralWindow(source, syntaxTree(state)));
}

function extractDirtyFootnoteWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyFootnoteWindowExtraction[] {
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

function mergeFromTransaction(
  before: FootnoteSlice,
  state: EditorState,
  target: string,
  insert: string,
): FootnoteSlice {
  const from = state.doc.toString().indexOf(target);
  if (from < 0) {
    throw new Error(`missing target: ${target}`);
  }

  const tr = state.update({
    changes: { from, to: from + target.length, insert },
  });
  const delta = buildSemanticDelta(tr);
  return mergeFootnoteSlice(
    before,
    delta,
    extractDirtyFootnoteWindows(tr.state, delta),
  );
}

function insertBeforeAndMerge(
  before: FootnoteSlice,
  state: EditorState,
  target: string,
  insert: string,
): FootnoteSlice {
  const from = state.doc.toString().indexOf(target);
  if (from < 0) {
    throw new Error(`missing target: ${target}`);
  }

  const tr = state.update({
    changes: { from, insert },
  });
  const delta = buildSemanticDelta(tr);
  return mergeFootnoteSlice(
    before,
    delta,
    extractDirtyFootnoteWindows(tr.state, delta),
  );
}

function mergeAndRebuild(
  state: EditorState,
  changes: ChangeSpec | readonly ChangeSpec[],
): { before: FootnoteSlice; after: FootnoteSlice; rebuilt: FootnoteSlice } {
  const before = analyzeFootnoteSlice(state);
  const tr = state.update({ changes });
  const delta = buildSemanticDelta(tr);
  const after = mergeFootnoteSlice(
    before,
    delta,
    extractDirtyFootnoteWindows(tr.state, delta),
  );
  const rebuilt = analyzeFootnoteSlice(tr.state);
  return { before, after, rebuilt };
}

describe("footnote slice", () => {
  it("preserves unrelated definition identity when editing one footnote definition", () => {
    const doc = [
      "Alpha[^a] Beta[^b].",
      "",
      "[^a]: first",
      "[^b]: second",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeFootnoteSlice(beforeState);
    const stableDef = before.definitions[1];
    const updatedDef = before.definitions[0];

    const after = mergeFromTransaction(before, beforeState, "first", "prime");

    expect(after.definitions).toHaveLength(2);
    expect(after.definitions[0]).not.toBe(updatedDef);
    expect(after.definitions[0].content).toBe("prime");
    expect(after.definitions[1]).toBe(stableDef);
    expect(after.defs.get("b")).toBe(stableDef);
    expect(after.defByFrom.get(stableDef.from)).toBe(stableDef);
  });

  it("preserves unrelated reference identity when editing one footnote ref", () => {
    const doc = [
      "Alpha[^a] Beta[^b].",
      "",
      "[^a]: first",
      "[^c]: third",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeFootnoteSlice(beforeState);
    const stableRef = before.refs[0];
    const updatedRef = before.refs[1];

    const after = mergeFromTransaction(before, beforeState, "[^b]", "[^c]");

    expect(after.refs).toHaveLength(2);
    expect(after.refs[0]).toBe(stableRef);
    expect(after.refs[1]).not.toBe(updatedRef);
    expect(after.refs[1].id).toBe("c");
    expect(after.refByFrom.get(stableRef.from)).toBe(stableRef);
    expect(after.refByFrom.get(after.refs[1].from)).toBe(after.refs[1]);
  });

  it("renumbers only the affected displayed footnote tail when an earlier ref is inserted", () => {
    const doc = [
      "Alpha[^a].",
      "Beta[^b].",
      "Gamma[^c].",
      "",
      "[^a]: first",
      "[^b]: second",
      "[^c]: third",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeFootnoteSlice(beforeState);
    const stablePrefixRef = before.refs[0];
    const priorTailEntry = before.orderedEntries[1];
    const after = insertBeforeAndMerge(before, beforeState, "[^b]", "[^c]");

    expect(Array.from(after.numberById.entries())).toEqual([
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
    expect(after.orderedEntries.map((entry) => ({
      id: entry.id,
      number: entry.number,
    }))).toEqual([
      { id: "a", number: 1 },
      { id: "c", number: 2 },
      { id: "b", number: 3 },
    ]);
    expect(after.refs[0]).toBe(stablePrefixRef);
    expect(after.orderedEntries[2]).not.toBe(priorTailEntry);
  });

  it("keeps ref and definition lookups aligned after combined incremental merges", () => {
    const doc = [
      "Alpha[^a] Beta[^b].",
      "",
      "[^a]: first",
      "[^b]: second",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeFootnoteSlice(beforeState);

    const tr = beforeState.update({
      changes: {
        from: beforeState.doc.toString().indexOf("[^b]: second"),
        to: beforeState.doc.toString().indexOf("[^b]: second") + "[^b]: second".length,
        insert: "[^b]: third",
      },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeFootnoteSlice(
      before,
      delta,
      extractDirtyFootnoteWindows(tr.state, delta),
    );

    for (const ref of after.refs) {
      expect(after.refByFrom.get(ref.from)).toBe(ref);
    }

    for (const def of after.definitions) {
      expect(after.defs.get(def.id)).toBe(def);
      expect(after.defByFrom.get(def.from)).toBe(def);
    }
  });

  it("matches a fresh rebuild when appending a trailing newline after the final definition", () => {
    const doc = [
      "Alpha[^a].",
      "Beta[^b].",
      "Gamma[^c].",
      "",
      "[^a]: first",
      "[^b]: second",
      "[^c]: third",
    ].join("\n");
    const state = createState(doc);
    const { after, rebuilt } = mergeAndRebuild(state, {
      from: state.doc.length,
      insert: "\n",
    });

    expect(after.definitions).toHaveLength(3);
    expect(after).toEqual(rebuilt);
  });

  it("matches a fresh rebuild when deleting a middle definition", () => {
    const doc = [
      "Alpha[^a].",
      "Beta[^b].",
      "Gamma[^c].",
      "",
      "[^a]: first",
      "[^b]: second",
      "[^c]: third",
      "",
    ].join("\n");
    const state = createState(doc);
    const target = "[^b]: second\n";
    const from = doc.indexOf(target);
    const { after, rebuilt } = mergeAndRebuild(state, {
      from,
      to: from + target.length,
      insert: "",
    });

    expect(after.definitions).toHaveLength(2);
    expect(after.definitions.map((def) => def.id)).toEqual(["a", "c"]);
    expect(after).toEqual(rebuilt);
  });

  it("matches a fresh rebuild when inserting a ref immediately before an existing ref", () => {
    const doc = [
      "Alpha[^a].",
      "Beta[^b].",
      "",
      "[^a]: first",
      "[^b]: second",
      "[^c]: third",
    ].join("\n");
    const state = createState(doc);
    const boundary = doc.indexOf("[^b]");
    const { after, rebuilt } = mergeAndRebuild(state, {
      from: boundary,
      insert: "[^c]",
    });

    expect(after.refs).toHaveLength(3);
    expect(after.refs.map((ref) => ref.id)).toEqual(["a", "c", "b"]);
    expect(after).toEqual(rebuilt);
  });

  it("matches a fresh rebuild for multi-range edits that shift and delete a boundary definition", () => {
    const doc = "alpha [^c].\n\n[^c]: delta\n[^a]: omega";
    const state = createState(doc);
    const { after, rebuilt } = mergeAndRebuild(state, [
      { from: 0, insert: "x" },
      { from: 10, to: 14, insert: "" },
    ]);

    expect(after.definitions.map((def) => def.id)).toEqual(["a"]);
    expect(after.orderedEntries).toEqual(rebuilt.orderedEntries);
    expect(after).toEqual(rebuilt);
  });
});
