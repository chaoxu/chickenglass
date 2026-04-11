import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../../parser";
import { analyzeDocumentSemantics } from "../../document";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import {
  extractDirtyFencedDivWindows,
  mergeFencedDivSlice,
} from "./fenced-div-slice";
import { deriveIncludeSlice } from "./include-slice";

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

describe("deriveIncludeSlice", () => {
  it("uses the block body instead of attribute title fallbacks for include paths", () => {
    const doc = '::: {.include title="attr.md"}\nbody.md\n:::\n';
    const state = createState(doc);
    const source = editorStateTextSource(state);
    const tree = fullTree(state);
    const analysis = analyzeDocumentSemantics(source, tree);

    const includes = deriveIncludeSlice(source, analysis.fencedDivs);

    expect(includes).toEqual(analysis.includes);
    expect(includes[0]?.path).toBe("body.md");
  });

  it("updates only affected include entries after fenced-div merge", () => {
    const doc = [
      "::: {.include}",
      "chapter1.md",
      ":::",
      "",
      "::: {.include}",
      "chapter2.md",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const before = analyzeDocumentSemantics(beforeDoc, fullTree(beforeState));
    const stableSecondInclude = before.includes[1];

    const from = doc.indexOf("chapter1.md");
    const tr = beforeState.update({
      changes: { from, to: from + "chapter1.md".length, insert: "chapterA.md" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );
    const afterFencedDivs = mergeFencedDivSlice(
      before.fencedDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    const afterIncludes = deriveIncludeSlice(
      afterDoc,
      afterFencedDivs,
      before.includes,
      tr.changes,
      delta.rawChangedRanges,
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).includes,
    );
    expect(afterIncludes[0]?.path).toBe("chapterA.md");
    expect(afterIncludes[1]).toBe(stableSecondInclude);
  });

  it("derives include membership from the merged fenced-div state", () => {
    const doc = [
      "::: {.proof}",
      "chapter1.md",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const before = analyzeDocumentSemantics(beforeDoc, fullTree(beforeState));

    const from = doc.indexOf(".proof") + 1;
    const tr = beforeState.update({
      changes: { from, to: from + "proof".length, insert: "include" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );
    const afterFencedDivs = mergeFencedDivSlice(
      before.fencedDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    const afterIncludes = deriveIncludeSlice(
      afterDoc,
      afterFencedDivs,
      before.includes,
      tr.changes,
      delta.rawChangedRanges,
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).includes,
    );
    expect(afterIncludes).toHaveLength(1);
    expect(afterIncludes[0]?.path).toBe("chapter1.md");
  });

  it("does not duplicate trailing includes when inserting at another include boundary", () => {
    const doc = [
      "::: {.include}",
      "chapter1.md",
      ":::",
      "",
      "::: {.include}",
      "chapter2.md",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const before = analyzeDocumentSemantics(beforeDoc, fullTree(beforeState));

    const secondStart = doc.indexOf("::: {.include}", 1);
    const tr = beforeState.update({
      changes: { from: secondStart, insert: "::: {.include}\nchapter0.md\n:::\n\n" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );
    const afterFencedDivs = mergeFencedDivSlice(
      before.fencedDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    const afterIncludes = deriveIncludeSlice(
      afterDoc,
      afterFencedDivs,
      before.includes,
      tr.changes,
      delta.rawChangedRanges,
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).includes,
    );
    expect(afterIncludes.map((include) => include.path)).toEqual([
      "chapter1.md",
      "chapter0.md",
      "chapter2.md",
    ]);
  });

  it("drops includes when an edit touching their start stops the div parsing", () => {
    const doc = [
      "para1",
      "",
      "::: {.include}",
      "chapter1.md",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const before = analyzeDocumentSemantics(beforeDoc, fullTree(beforeState));

    const from = doc.indexOf("1\n\n:::");
    const tr = beforeState.update({
      changes: { from, to: from + 3, insert: ".include" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );
    const afterFencedDivs = mergeFencedDivSlice(
      before.fencedDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    const afterIncludes = deriveIncludeSlice(
      afterDoc,
      afterFencedDivs,
      before.includes,
      tr.changes,
      delta.rawChangedRanges,
    );

    expect(afterFencedDivs).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).fencedDivs,
    );
    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).includes,
    );
    expect(afterIncludes).toEqual([]);
  });

  it("keeps include paths when an edit removes the closing fence", () => {
    const doc = "::: {.include}\nchapter1.md\n:::\n";
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const before = analyzeDocumentSemantics(beforeDoc, fullTree(beforeState));

    const closeFenceFrom = doc.lastIndexOf("\n:::") + 1;
    const tr = beforeState.update({
      changes: { from: closeFenceFrom, to: closeFenceFrom + 3, insert: "" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );
    const afterFencedDivs = mergeFencedDivSlice(
      before.fencedDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    const afterIncludes = deriveIncludeSlice(
      afterDoc,
      afterFencedDivs,
      before.includes,
      tr.changes,
      delta.rawChangedRanges,
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, fullTree(tr.state)).includes,
    );
    expect(afterIncludes[0]?.path).toBe("chapter1.md");
  });
});
