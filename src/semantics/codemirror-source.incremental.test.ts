import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import { documentAnalysisField } from "./codemirror-source";

// Future incremental-engine contract tests. The identity cases stay marked as
// expected failures until documentAnalysisField stops rebuilding whole slices.

function createSemanticsState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
    ],
  });
}

function replaceOnce(state: EditorState, target: string, insert: string): EditorState {
  const from = state.doc.toString().indexOf(target);
  if (from < 0) {
    throw new Error(`missing target: ${target}`);
  }
  return state.update({
    changes: { from, to: from + target.length, insert },
  }).state;
}

function insertBefore(state: EditorState, target: string, insert: string): EditorState {
  const from = state.doc.toString().indexOf(target);
  if (from < 0) {
    throw new Error(`missing target: ${target}`);
  }
  return state.update({
    changes: { from, insert },
  }).state;
}

describe("documentAnalysisField incremental contract", () => {
  it.fails("reuses unchanged math region objects across unrelated edits", () => {
    const doc = [
      "Alpha $x$.",
      "",
      "Middle paragraph.",
      "",
      "Omega $y$.",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stableMath = before.mathRegions[0];

    const afterState = insertBefore(beforeState, "Omega", "Unrelated text.\n\n");
    const after = afterState.field(documentAnalysisField);

    expect(after.mathRegions).toHaveLength(2);
    expect(after.mathRegions[0]).toBe(stableMath);
    expect(after.mathRegions.map((region) => region.latex)).toEqual(["x", "y"]);
  });

  it.fails("preserves unaffected heading prefix identity while renumbering the tail", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
      "",
      "## Results",
      "",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stablePrefix = before.headings[0];
    const renumberedTail = before.headings[1];

    const afterState = insertBefore(beforeState, "## Methods", "## Background\n\n");
    const after = afterState.field(documentAnalysisField);

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
  });

  it("keeps unrelated fenced div objects when editing another div body", () => {
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

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stableSecondDiv = before.fencedDivs[1];

    const afterState = replaceOnce(beforeState, "alpha", "omega");
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs).toHaveLength(2);
    expect(after.fencedDivs[0].title).toBe("First");
    expect(after.fencedDivs[1].title).toBe("Second");
    expect(after.fencedDivs[1]).toBe(stableSecondDiv);
  });

  it("updates only the affected include entry", () => {
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

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stableSecondInclude = before.includes[1];

    const afterState = replaceOnce(beforeState, "chapter1.md", "chapterA.md");
    const after = afterState.field(documentAnalysisField);

    expect(after.includes).toHaveLength(2);
    expect(after.includes[0]?.path).toBe("chapterA.md");
    expect(after.includes[1]?.path).toBe("chapter2.md");
    expect(after.includes[1]).toBe(stableSecondInclude);
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

    const beforeState = createSemanticsState(doc);
    const secondStart = doc.indexOf("::: {.include}", 1);
    const afterState = beforeState.update({
      changes: { from: secondStart, insert: "::: {.include}\nchapter0.md\n:::\n\n" },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.includes.map((include) => include.path)).toEqual([
      "chapter1.md",
      "chapter0.md",
      "chapter2.md",
    ]);
    expect(after.fencedDivs).toHaveLength(3);
  });

  it("updates adjacent div positions when a boundary edit changes the next block", () => {
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

    const beforeState = createSemanticsState(doc);
    const closeFenceFrom = doc.indexOf("\n:::\n") + 1;
    const afterState = beforeState.update({
      changes: { from: closeFenceFrom, to: closeFenceFrom + 3, insert: "" },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs).toHaveLength(2);
    expect(after.fencedDivs[0]?.to).toBe(57);
    expect(after.fencedDivs[1]?.from).toBe(29);
    expect(after.fencedDivs[1]?.to).toBe(53);
    expect(after.fencedDivs[1]?.closeFenceFrom).toBe(54);
  });

  it("keeps narrative references correct around link, code, and math exclusion boundaries", () => {
    const doc = [
      "Lead @lead.",
      "[@skip]@afterLink",
      "`@code`@afterCode",
      "$@math$@afterMath",
    ].join("\n");

    let state = createSemanticsState(doc);
    state = replaceOnce(state, "@skip", "@omit");
    state = replaceOnce(state, "@code", "@mask");
    state = replaceOnce(state, "@math", "@calc");

    const analysis = state.field(documentAnalysisField);
    const bracketedIds = analysis.references
      .filter((reference) => reference.bracketed)
      .flatMap((reference) => reference.ids);
    const narrativeIds = analysis.references
      .filter((reference) => !reference.bracketed)
      .flatMap((reference) => reference.ids);

    expect(bracketedIds).toEqual(["omit"]);
    expect(narrativeIds).toEqual(["lead", "afterLink", "afterCode", "afterMath"]);
    expect(narrativeIds).not.toContain("mask");
    expect(narrativeIds).not.toContain("calc");
  });
});
