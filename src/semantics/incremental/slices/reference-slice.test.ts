import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import { extractStructuralWindow } from "../window-extractor";
import {
  buildReferenceSlice,
  mapReferenceSemantics,
  mergeReferenceSlice,
  type DirtyReferenceWindowExtraction,
  type ReferenceSlice,
} from "./reference-slice";

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

function analyzeReferenceSlice(state: EditorState): ReferenceSlice {
  const source = editorStateTextSource(state);
  return buildReferenceSlice(extractStructuralWindow(source, fullTree(state)));
}

function extractDirtyReferenceWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyReferenceWindowExtraction[] {
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

describe("reference slice", () => {
  it("maps unchanged bracketed reference offsets through transaction changes", () => {
    const doc = [
      "See [@first].",
      "",
      "See [@second].",
    ].join("\n");
    const state = createState(doc);
    const before = analyzeReferenceSlice(state);
    const second = before.bracketedReferences[1];
    const insert = "Lead paragraph.\n\n";
    const insertAt = doc.indexOf("See [@second]");
    const tr = state.update({
      changes: { from: insertAt, insert },
    });

    const mapped = mapReferenceSemantics(second, tr.changes);

    expect(mapped).toEqual({
      ...second,
      from: second.from + insert.length,
      to: second.to + insert.length,
    });
    expect(mapped).not.toBe(second);
  });

  it("replaces only the edited bracketed reference inside a dirty window", () => {
    const doc = [
      "See [@alpha].",
      "",
      "See [@beta].",
      "",
      "See [@gamma].",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeReferenceSlice(beforeState);
    const tr = beforeState.update({
      changes: {
        from: doc.indexOf("@beta"),
        to: doc.indexOf("@beta") + "@beta".length,
        insert: "@zeta",
      },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeReferenceSlice(
      before,
      delta,
      extractDirtyReferenceWindows(tr.state, delta),
    );

    expect(after.bracketedReferences).toHaveLength(3);
    expect(after.bracketedReferences[0]).toBe(before.bracketedReferences[0]);
    expect(after.bracketedReferences[1]).not.toBe(before.bracketedReferences[1]);
    expect(after.bracketedReferences[1].ids).toEqual(["zeta"]);
    expect(after.bracketedReferences[2]).toBe(before.bracketedReferences[2]);
    expect(after.referenceByFrom.get(after.bracketedReferences[1].from)).toBe(
      after.bracketedReferences[1],
    );
  });

  it("incrementally merges narrative references after exclusion edits", () => {
    const doc = [
      "Lead @lead.",
      "[@skip]@afterLink",
      "`@code`@afterCode",
      "$@math$@afterMath",
    ].join("\n");

    let state = createState(doc);
    let slice = analyzeReferenceSlice(state);

    for (const [target, insert] of [
      ["@skip", "@omit"],
      ["@code", "@mask"],
      ["@math", "@calc"],
    ] as const) {
      const from = state.doc.toString().indexOf(target);
      const tr = state.update({
        changes: { from, to: from + target.length, insert },
      });
      const delta = buildSemanticDelta(tr);

      slice = mergeReferenceSlice(
        slice,
        delta,
        extractDirtyReferenceWindows(tr.state, delta),
      );
      state = tr.state;
    }

    expect(slice.bracketedReferences.map((reference) => reference.ids[0])).toEqual(["omit"]);
    expect(slice.narrativeReferences.map((reference) => reference.ids[0])).toEqual([
      "lead",
      "afterLink",
      "afterCode",
      "afterMath",
    ]);
    expect(slice.narrativeReferences.map((reference) => reference.ids[0])).not.toContain("mask");
    expect(slice.narrativeReferences.map((reference) => reference.ids[0])).not.toContain("calc");
  });

  it("keeps combined references sorted and source-compatible", () => {
    const doc = "See @lead and [@alpha] and @tail.";
    const slice = analyzeReferenceSlice(createState(doc));

    expect(slice.references.map((reference) => ({
      ids: reference.ids,
      bracketed: reference.bracketed,
    }))).toEqual([
      { ids: ["lead"], bracketed: false },
      { ids: ["alpha"], bracketed: true },
      { ids: ["tail"], bracketed: false },
    ]);
    expect(slice.referenceByFrom.get(slice.references[0].from)).toBe(slice.references[0]);
    expect(slice.referenceByFrom.get(slice.references[1].from)).toBe(slice.references[1]);
    expect(slice.referenceByFrom.get(slice.references[2].from)).toBe(slice.references[2]);
  });

  it("excludes narrative references inside code spans", () => {
    const doc = "See `@hidden` and @visible ref.";
    const slice = analyzeReferenceSlice(createState(doc));

    expect(slice.narrativeReferences.map((r) => r.ids[0])).toEqual(["visible"]);
  });

  it("excludes narrative references inside inline math", () => {
    const doc = "See $@hidden$ and @visible ref.";
    const slice = analyzeReferenceSlice(createState(doc));

    expect(slice.narrativeReferences.map((r) => r.ids[0])).toEqual(["visible"]);
  });

  it("excludes narrative references inside links", () => {
    const doc = "See [@hidden] and @visible ref.";
    const slice = analyzeReferenceSlice(createState(doc));

    expect(slice.narrativeReferences.map((r) => r.ids[0])).toEqual(["visible"]);
  });

  it("preserves narrative references outside dirty windows on incremental update", () => {
    const doc = [
      "First @alpha ref.",
      "",
      "Second @beta ref.",
    ].join("\n");
    const state = createState(doc);
    const before = analyzeReferenceSlice(state);

    expect(before.narrativeReferences.map((r) => r.ids[0])).toEqual(["alpha", "beta"]);

    const insertAt = doc.indexOf("Second");
    const tr = state.update({
      changes: { from: insertAt, insert: "Prefix " },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeReferenceSlice(
      before,
      delta,
      extractDirtyReferenceWindows(tr.state, delta),
    );

    expect(after.narrativeReferences.map((r) => r.ids[0])).toEqual(["alpha", "beta"]);
    // The first narrative ref should be identity-preserved (untouched window).
    expect(after.narrativeReferences[0]).toBe(before.narrativeReferences[0]);
  });

  it("picks up a new narrative reference inserted via incremental update", () => {
    const doc = "See @alpha ref.";
    const state = createState(doc);
    const before = analyzeReferenceSlice(state);

    expect(before.narrativeReferences.map((r) => r.ids[0])).toEqual(["alpha"]);

    // Insert a second narrative reference in the same line.
    const insertAt = doc.indexOf(" ref.");
    const tr = state.update({
      changes: { from: insertAt, insert: " and @beta" },
    });
    const delta = buildSemanticDelta(tr);
    const after = mergeReferenceSlice(
      before,
      delta,
      extractDirtyReferenceWindows(tr.state, delta),
    );

    expect(after.narrativeReferences.map((r) => r.ids[0])).toEqual(["alpha", "beta"]);
  });
});
