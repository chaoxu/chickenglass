import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../parser";
import { editorStateTextSource } from "../../state/document-analysis";
import { ensureFullSyntaxTree } from "../../test-utils";
import type { DocumentAnalysisSlices } from "./slice-registry";
import {
  buildSlicesAndExcludedRanges,
  finalizeDocumentAnalysis,
} from "./snapshot-finalize";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullBuild(docText: string) {
  const state = createState(docText);
  const doc = editorStateTextSource(state);
  const tree = ensureFullSyntaxTree(state);
  return {
    doc,
    ...buildSlicesAndExcludedRanges(doc, tree),
  };
}

describe("snapshot finalization", () => {
  it("reuses the previous snapshot when slices and exclusions are unchanged", () => {
    const { doc, slices, excludedRanges } = fullBuild("# Intro\n\nAlpha $x$.");
    const before = finalizeDocumentAnalysis(undefined, slices, excludedRanges, doc);
    const after = finalizeDocumentAnalysis(before, slices, excludedRanges, doc);

    expect(after).toBe(before);
  });

  it("tracks revisions at the changed slice boundary", () => {
    const { doc, slices, excludedRanges } = fullBuild("# Intro\n\nAlpha $x$.");
    const before = finalizeDocumentAnalysis(undefined, slices, excludedRanges, doc);
    const nextSlices: DocumentAnalysisSlices = {
      ...slices,
      mathSlice: {
        mathRegions: [...slices.mathSlice.mathRegions],
      },
    };
    const after = finalizeDocumentAnalysis(before, nextSlices, excludedRanges, doc);

    expect(after).not.toBe(before);
    expect(after.incrementalState.revisions.revision).toBe(
      before.incrementalState.revisions.revision + 1,
    );
    expect(after.incrementalState.revisions.slices.mathRegions).toBe(
      before.incrementalState.revisions.slices.mathRegions + 1,
    );
    expect(after.incrementalState.revisions.slices.headings).toBe(
      before.incrementalState.revisions.slices.headings,
    );
    expect(after.incrementalState.referenceIndex).toBe(
      before.incrementalState.referenceIndex,
    );
  });
});
