import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { editorStateTextSource } from "../../codemirror-source";
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
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function analyzeReferenceSlice(state: EditorState): ReferenceSlice {
  const source = editorStateTextSource(state);
  return buildReferenceSlice(source, extractStructuralWindow(source, syntaxTree(state)));
}

function extractDirtyReferenceWindows(
  state: EditorState,
  delta: ReturnType<typeof buildSemanticDelta>,
): DirtyReferenceWindowExtraction[] {
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
      editorStateTextSource(tr.state),
      delta,
      extractDirtyReferenceWindows(tr.state, delta),
      extractStructuralWindow(editorStateTextSource(tr.state), syntaxTree(tr.state)).excludedRanges,
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

  it("recomputes narrative references through the global fallback after exclusion edits", () => {
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
        editorStateTextSource(tr.state),
        delta,
        extractDirtyReferenceWindows(tr.state, delta),
        extractStructuralWindow(editorStateTextSource(tr.state), syntaxTree(tr.state)).excludedRanges,
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
});
