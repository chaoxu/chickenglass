import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../parser";
import { editorStateTextSource } from "../codemirror-source";
import { buildSemanticDelta } from "./semantic-delta";
import {
  createDocumentAnalysis,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
  updateDocumentAnalysis,
} from "./engine";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function analyze(state: EditorState) {
  return createDocumentAnalysis(editorStateTextSource(state), syntaxTree(state));
}

describe("incremental document analysis engine", () => {
  it("reuses the prior analysis when an edit lands after all semantic ranges", () => {
    const state = createState([
      "# Intro",
      "",
      "Alpha $x$.",
    ].join("\n"));
    const before = analyze(state);
    const tr = state.update({
      changes: {
        from: state.doc.length,
        insert: "\n\nTail paragraph.",
      },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      syntaxTree(tr.state),
      buildSemanticDelta(tr),
    );

    expect(after).toBe(before);
    expect(getDocumentAnalysisRevision(after)).toBe(
      getDocumentAnalysisRevision(before),
    );
  });

  it("bumps only the affected slice revision on a local math edit", () => {
    const state = createState([
      "# Intro",
      "",
      "Alpha $x$.",
      "",
      "Tail paragraph.",
    ].join("\n"));
    const before = analyze(state);
    const from = state.doc.toString().indexOf("$x$") + 1;
    const tr = state.update({
      changes: {
        from,
        to: from + 1,
        insert: "y",
      },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      syntaxTree(tr.state),
      buildSemanticDelta(tr),
    );

    expect(getDocumentAnalysisRevision(after)).toBe(
      getDocumentAnalysisRevision(before) + 1,
    );
    expect(getDocumentAnalysisSliceRevision(after, "mathRegions")).toBe(
      getDocumentAnalysisSliceRevision(before, "mathRegions") + 1,
    );
    expect(getDocumentAnalysisSliceRevision(after, "headings")).toBe(
      getDocumentAnalysisSliceRevision(before, "headings"),
    );
    expect(getDocumentAnalysisSliceRevision(after, "footnotes")).toBe(
      getDocumentAnalysisSliceRevision(before, "footnotes"),
    );
    expect(getDocumentAnalysisSliceRevision(after, "fencedDivs")).toBe(
      getDocumentAnalysisSliceRevision(before, "fencedDivs"),
    );
    expect(getDocumentAnalysisSliceRevision(after, "equations")).toBe(
      getDocumentAnalysisSliceRevision(before, "equations"),
    );
    expect(getDocumentAnalysisSliceRevision(after, "references")).toBe(
      getDocumentAnalysisSliceRevision(before, "references"),
    );
    expect(getDocumentAnalysisSliceRevision(after, "includes")).toBe(
      getDocumentAnalysisSliceRevision(before, "includes"),
    );
    expect(after.headings).toBe(before.headings);
    expect(after.mathRegions[0]).not.toBe(before.mathRegions[0]);
  });

  it("keeps revisions off the public enumerable DocumentAnalysis shape", () => {
    const analysis = analyze(createState("Alpha $x$."));

    expect(Object.keys(analysis).sort()).toEqual([
      "equationById",
      "equations",
      "fencedDivByFrom",
      "fencedDivs",
      "footnotes",
      "headingByFrom",
      "headings",
      "includeByFrom",
      "includes",
      "mathRegions",
      "referenceByFrom",
      "references",
    ]);
    expect("revision" in analysis).toBe(false);
  });
});
