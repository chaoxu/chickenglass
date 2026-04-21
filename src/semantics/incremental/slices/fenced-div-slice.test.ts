import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../../parser";
import { ensureFullSyntaxTree } from "../../../test-utils";
import { analyzeFencedDivs } from "../../document";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import {
  extractDirtyFencedDivWindows,
  mergeFencedDivSlice,
} from "./fenced-div-slice";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
}

describe("mergeFencedDivSlice", () => {
  it("replaces only dirty-window overlaps and preserves unrelated identity", () => {
    const doc = [
      "::: {.theorem #thm:first} First",
      "alpha",
      ":::",
      "",
      "::: {.proof #prf:second} Second",
      "beta",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const beforeDivs = analyzeFencedDivs(beforeDoc, fullTree(beforeState));
    const stableSecondDiv = beforeDivs[1];

    const from = doc.indexOf("alpha");
    const tr = beforeState.update({
      changes: { from, to: from + "alpha".length, insert: "omega" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, fullTree(tr.state)));
    expect(afterDivs[1]).toBe(stableSecondDiv);
    expect(afterDivs[0]).not.toBe(beforeDivs[0]);
  });

  it("replaces a div when a deletion collapses the dirty window onto its end", () => {
    const doc = [
      "::: {.theorem #thm:first} First",
      "alpha",
      ":::",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const beforeDivs = analyzeFencedDivs(beforeDoc, fullTree(beforeState));

    const from = doc.indexOf("alpha");
    const tr = beforeState.update({
      changes: { from, to: doc.length, insert: "" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, fullTree(tr.state)));
    expect(afterDivs[0]?.closeFenceFrom).toBe(-1);
    expect(afterDivs[0]?.closeFenceTo).toBe(-1);
  });

  it("re-extracts adjacent divs when a boundary edit changes the next block", () => {
    const doc = [
      "::: {.theorem} First",
      "alpha",
      ":::",
      "",
      "::: {.proof} Second",
      "beta",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const beforeDivs = analyzeFencedDivs(beforeDoc, fullTree(beforeState));

    const closeFenceFrom = doc.indexOf("\n:::\n") + 1;
    const tr = beforeState.update({
      changes: { from: closeFenceFrom, to: closeFenceFrom + 3, insert: "" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, fullTree(tr.state)));
    expect(afterDivs).toHaveLength(2);
    expect(afterDivs[1]?.to).toBe(53);
    expect(afterDivs[1]?.closeFenceFrom).toBe(54);
  });

  it("drops a div when an edit touching its start stops it parsing", () => {
    const doc = [
      "para1",
      "",
      "::: {.proof}",
      "beta",
      ":::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const beforeDivs = analyzeFencedDivs(beforeDoc, fullTree(beforeState));

    const from = doc.indexOf("1\n\n:::");
    const tr = beforeState.update({
      changes: { from, to: from + 3, insert: ".proof" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, fullTree(tr.state)));
    expect(afterDivs).toEqual([]);
  });

  it("keeps nested outer divs in sync when deleting the outer closing fence", () => {
    const doc = [
      ":::: {.proof}",
      "alpha",
      "::: {.custom-note}",
      "new.md",
      ":::",
      "omega",
      "::::::",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const beforeDoc = editorStateTextSource(beforeState);
    const beforeDivs = analyzeFencedDivs(beforeDoc, fullTree(beforeState));

    const from = doc.lastIndexOf("::::::");
    const tr = beforeState.update({
      changes: { from, to: from + 6, insert: "" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      fullTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, fullTree(tr.state)));
    expect(afterDivs[0]?.primaryClass).toBe("proof");
    expect(afterDivs[0]?.closeFenceFrom).toBe(-1);
    expect(afterDivs[0]?.closeFenceTo).toBe(-1);
  });
});
