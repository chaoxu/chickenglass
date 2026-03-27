import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../../parser";
import { analyzeDocumentSemantics } from "../../document";
import { editorStateTextSource } from "../../codemirror-source";
import { buildSemanticDelta } from "../semantic-delta";
import {
  extractDirtyFencedDivWindows,
  mergeFencedDivSlice,
} from "./fenced-div-slice";
import { deriveIncludeSlice } from "./include-slice";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

describe("deriveIncludeSlice", () => {
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
    const before = analyzeDocumentSemantics(beforeDoc, syntaxTree(beforeState));
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
      syntaxTree(tr.state),
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
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, syntaxTree(tr.state)).includes,
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
    const before = analyzeDocumentSemantics(beforeDoc, syntaxTree(beforeState));

    const from = doc.indexOf(".proof") + 1;
    const tr = beforeState.update({
      changes: { from, to: from + "proof".length, insert: "include" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      before.fencedDivs,
      afterDoc,
      syntaxTree(tr.state),
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
    );

    expect(afterIncludes).toEqual(
      analyzeDocumentSemantics(afterDoc, syntaxTree(tr.state)).includes,
    );
    expect(afterIncludes).toHaveLength(1);
    expect(afterIncludes[0]?.path).toBe("chapter1.md");
  });
});
