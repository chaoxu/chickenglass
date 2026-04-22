import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import { ensureFullSyntaxTree } from "../test-utils";
import { analyzeDocumentSemantics } from "./document";
import {
  documentAnalysisField,
  editorStateTextSource,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";

function createSemanticsState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
    ],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
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

function expectEquationStateMatchesRebuild(state: EditorState): void {
  const analysis = state.field(documentAnalysisField);
  const rebuilt = analyzeDocumentSemantics(
    editorStateTextSource(state),
    fullTree(state),
  );

  expect(analysis.equations).toEqual(rebuilt.equations);
  expect(Array.from(analysis.equationById.keys())).toEqual(
    rebuilt.equations.map((equation) => equation.id),
  );

  for (const equation of analysis.equations) {
    expect(analysis.equationById.get(equation.id)).toBe(equation);
  }
}

describe("documentAnalysisField incremental contract", () => {
  it("keeps CM6 text-source slices and lines correct after slice caching activates", () => {
    const state = EditorState.create({
      doc: "Alpha\nBeta\nGamma",
    });
    const source = editorStateTextSource(state);

    for (let i = 0; i < 8; i++) {
      expect(source.slice(0, 1)).toBe("A");
    }

    expect(source.slice(6, 10)).toBe("Beta");
    expect(source.lineAt(7)).toEqual({
      from: 6,
      to: 10,
      text: "Beta",
    });
  });

  it("reuses unchanged math region objects across unrelated edits", () => {
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

  it("preserves unaffected heading prefix identity while renumbering the tail", () => {
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

  it("reuses the prior analysis object on no-op transactions", () => {
    const state = createSemanticsState("Alpha $x$.");
    const before = state.field(documentAnalysisField);
    const afterState = state.update({}).state;
    const after = afterState.field(documentAnalysisField);

    expect(after).toBe(before);
    expect(getDocumentAnalysisRevision(after)).toBe(
      getDocumentAnalysisRevision(before),
    );
  });

  it("bumps only the affected slice revision on a local math edit", () => {
    const beforeState = createSemanticsState([
      "# Intro",
      "",
      "Alpha $x$.",
      "",
      "Tail paragraph.",
    ].join("\n"));
    const before = beforeState.field(documentAnalysisField);
    const from = beforeState.doc.toString().indexOf("$x$") + 1;
    const afterState = beforeState.update({
      changes: {
        from,
        to: from + 1,
        insert: "y",
      },
    }).state;
    const after = afterState.field(documentAnalysisField);

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
  });

  it("drops a display-math region when its opening delimiter is deleted", () => {
    const beforeState = createSemanticsState([
      "before",
      "",
      "$$",
      "x",
      "$$",
      "",
      "after",
    ].join("\n"));

    const afterState = replaceOnce(beforeState, "$$\n", "");
    const after = afterState.field(documentAnalysisField);
    const rebuilt = analyzeDocumentSemantics(
      editorStateTextSource(afterState),
      fullTree(afterState),
    );

    expect(after.mathRegions).toEqual(rebuilt.mathRegions);
    expect(after.mathRegions.map((region) => region.latex)).toEqual(
      rebuilt.mathRegions.map((region) => region.latex),
    );
  });

  it("preserves unaffected equation prefix identity while renumbering the tail", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
      "",
      "Tail paragraph.",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stablePrefix = before.equations[0];
    const renumberedTail = before.equations[1];

    const afterState = insertBefore(
      beforeState,
      "$$y$$",
      "$$w$$ {#eq:middle}\n\n",
    );
    const after = afterState.field(documentAnalysisField);

    expect(after.equations.map(({ id, number }) => ({ id, number }))).toEqual([
      { id: "eq:first", number: 1 },
      { id: "eq:middle", number: 2 },
      { id: "eq:second", number: 3 },
    ]);
    expect(after.equations[0]).toBe(stablePrefix);
    expect(after.equations[2]).not.toBe(renumberedTail);
    expectEquationStateMatchesRebuild(afterState);
  });

  it("preserves an unaffected equation suffix when editing one equation body", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
      "",
      "$$z$$ {#eq:third}",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stableFirst = before.equations[0];
    const updatedSecond = before.equations[1];
    const stableThird = before.equations[2];
    const from = doc.indexOf("$$y$$") + 2;
    const afterState = beforeState.update({
      changes: {
        from,
        to: from + 1,
        insert: "w",
      },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.equations[0]).toBe(stableFirst);
    expect(after.equations[1]).not.toBe(updatedSecond);
    expect(after.equations[1]?.latex).toBe("w");
    expect(after.equations[2]).toBe(stableThird);
    expectEquationStateMatchesRebuild(afterState);
  });

  const equationBoundaryScenarios: Array<{
    readonly title: string;
    readonly doc: string;
    readonly update: (state: EditorState) => EditorState;
    readonly expected: Array<{ readonly id: string; readonly number: number }>;
  }> = [
    {
      title: "deleting only an equation label",
      doc: [
        "$$x$$ {#eq:first}",
        "",
        "$$y$$ {#eq:second}",
        "",
        "$$z$$ {#eq:third}",
      ].join("\n"),
      update(state) {
        const doc = state.doc.toString();
        const label = " {#eq:second}";
        return state.update({
          changes: {
            from: doc.indexOf(label),
            to: doc.indexOf(label) + label.length,
          },
        }).state;
      },
      expected: [
        { id: "eq:first", number: 1 },
        { id: "eq:third", number: 2 },
      ],
    },
    {
      title: "replacing a range that removes an earlier label and rewrites a later equation",
      doc: [
        "$$x$$ {#eq:first}",
        "",
        "$$y$$ {#eq:second}",
        "",
        "$$z$$ {#eq:third}",
      ].join("\n"),
      update(state) {
        const doc = state.doc.toString();
        const start = doc.indexOf(" {#eq:first}");
        const end = doc.indexOf("$$z$$");
        return state.update({
          changes: {
            from: start,
            to: end,
            insert: "\n\n$$y2$$ {#eq:second}\n\n",
          },
        }).state;
      },
      expected: [
        { id: "eq:second", number: 1 },
        { id: "eq:third", number: 2 },
      ],
    },
    {
      title: "deleting an equation opener",
      doc: [
        "Intro.",
        "",
        "$$x$$ {#eq:first}",
      ].join("\n"),
      update(state) {
        const doc = state.doc.toString();
        const from = doc.indexOf("$$x$$");
        return state.update({
          changes: {
            from,
            to: from + 2,
          },
        }).state;
      },
      expected: [],
    },
    {
      title: "inserting text immediately before an equation opener",
      doc: [
        "$$x$$ {#eq:first}",
        "",
        "$$y$$ {#eq:second}",
        "",
        "$$z$$ {#eq:third}",
      ].join("\n"),
      update(state) {
        return state.update({
          changes: {
            from: 0,
            insert: "X",
          },
        }).state;
      },
      expected: [
        { id: "eq:second", number: 1 },
        { id: "eq:third", number: 2 },
      ],
    },
    {
      title: "editing text immediately before an equation opener",
      doc: [
        "[@cite]",
        "",
        "$$y$$ {#eq:second}",
      ].join("\n"),
      update(state) {
        const doc = state.doc.toString();
        const from = doc.indexOf("\n\n$$y$$");
        return state.update({
          changes: {
            from,
            to: from + 2,
            insert: "\n {#eq:edit}",
          },
        }).state;
      },
      expected: [],
    },
    {
      title: "deleting a middle equation closer so it absorbs the later block",
      doc: [
        "$$x$$ {#eq:first}",
        "",
        "$$y$$ {#eq:second}",
        "",
        "$$z$$ {#eq:third}",
      ].join("\n"),
      update(state) {
        const doc = state.doc.toString();
        const from = doc.indexOf("$$y$$ {#eq:second}") + "$$y".length;
        return state.update({
          changes: {
            from,
            to: from + 2,
          },
        }).state;
      },
      expected: [
        { id: "eq:first", number: 1 },
      ],
    },
  ];

  for (const scenario of equationBoundaryScenarios) {
    it(`keeps equations aligned with a full rebuild when ${scenario.title}`, () => {
      const baseState = createSemanticsState(scenario.doc);
      const afterState = scenario.update(baseState);
      const after = afterState.field(documentAnalysisField);

      expect(after.equations.map(({ id, number }) => ({ id, number }))).toEqual(
        scenario.expected,
      );
      expectEquationStateMatchesRebuild(afterState);
    });
  }

  it("keeps unrelated fenced div objects when editing another div body", () => {
    const doc = [
      '::: {.theorem #thm:first title="First"}',
      "alpha",
      ":::",
      "",
      '::: {.proof #prf:second title="Second"}',
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

  it("treats unknown custom blocks as ordinary fenced divs during updates", () => {
    const doc = [
      "::: {.custom-note}",
      "first.md",
      ":::",
      "",
      "::: {.custom-note}",
      "second.md",
      ":::",
      "",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const before = beforeState.field(documentAnalysisField);
    const stableSecondDiv = before.fencedDivs[1];

    const afterState = replaceOnce(beforeState, "first.md", "other.md");
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs).toHaveLength(2);
    expect(after.fencedDivs[0]?.primaryClass).toBe("custom-note");
    expect(after.fencedDivs[1]).toBe(stableSecondDiv);
  });

  it("does not duplicate trailing custom divs when inserting at another boundary", () => {
    const doc = [
      "::: {.custom-note}",
      "first.md",
      ":::",
      "",
      "::: {.custom-note}",
      "second.md",
      ":::",
      "",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const secondStart = doc.indexOf("::: {.custom-note}", 1);
    const afterState = beforeState.update({
      changes: { from: secondStart, insert: "::: {.custom-note}\ninserted.md\n:::\n\n" },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs).toHaveLength(3);
    expect(after.fencedDivs.map((div) => div.primaryClass)).toEqual([
      "custom-note",
      "custom-note",
      "custom-note",
    ]);
  });

  it("updates adjacent div positions when a boundary edit changes the next block", () => {
    const doc = [
      '::: {.theorem title="First"}',
      "alpha",
      ":::",
      "",
      '::: {.proof title="Second"}',
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

    const rebuilt = analyzeDocumentSemantics(
      editorStateTextSource(afterState),
      fullTree(afterState),
    );
    expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
    expect(after.fencedDivs).toHaveLength(2);
    expect(after.fencedDivs[0]?.title).toBe("First");
    expect(after.fencedDivs[1]?.title).toBe("Second");
    expect(after.fencedDivs[1]?.primaryClass).toBe("proof");
  });

  it("drops disappearing custom div state after a touching-start boundary edit", () => {
    const doc = [
      "para1",
      "",
      "::: {.custom-note}",
      "chapter1.md",
      ":::",
      "",
    ].join("\n");

    const beforeState = createSemanticsState(doc);
    const from = doc.indexOf("1\n\n:::");
    const afterState = beforeState.update({
      changes: { from, to: from + 3, insert: ".custom-note" },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs).toEqual([]);
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

    const beforeState = createSemanticsState(doc);
    const from = doc.lastIndexOf("::::::");
    const afterState = beforeState.update({
      changes: { from, to: from + 6, insert: "" },
    }).state;
    const after = afterState.field(documentAnalysisField);

    expect(after.fencedDivs[0]?.primaryClass).toBe("proof");
    expect(after.fencedDivs[0]?.closeFenceFrom).toBe(-1);
    expect(after.fencedDivs[0]?.closeFenceTo).toBe(-1);
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
