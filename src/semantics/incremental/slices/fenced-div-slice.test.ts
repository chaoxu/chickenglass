import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../../parser";
import { analyzeFencedDivs } from "../../document";
import { editorStateTextSource } from "../../codemirror-source";
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
    const beforeDivs = analyzeFencedDivs(beforeDoc, syntaxTree(beforeState));
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
      syntaxTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, syntaxTree(tr.state)));
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
    const beforeDivs = analyzeFencedDivs(beforeDoc, syntaxTree(beforeState));

    const from = doc.indexOf("alpha");
    const tr = beforeState.update({
      changes: { from, to: doc.length, insert: "" },
    });
    const afterDoc = editorStateTextSource(tr.state);
    const delta = buildSemanticDelta(tr);
    const extractedDirtyWindows = extractDirtyFencedDivWindows(
      beforeDivs,
      afterDoc,
      syntaxTree(tr.state),
      tr.changes,
      delta.dirtyWindows,
    );

    const afterDivs = mergeFencedDivSlice(
      beforeDivs,
      tr.changes,
      extractedDirtyWindows,
    );

    expect(afterDivs).toEqual(analyzeFencedDivs(afterDoc, syntaxTree(tr.state)));
    expect(afterDivs[0]?.closeFenceFrom).toBe(-1);
    expect(afterDivs[0]?.closeFenceTo).toBe(-1);
  });
});
