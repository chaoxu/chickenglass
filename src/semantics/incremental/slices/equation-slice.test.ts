import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../parser";
import { ensureFullSyntaxTree } from "../../../test-utils";
import { editorStateTextSource } from "../../../state/document-analysis";
import { buildSemanticDelta } from "../semantic-delta";
import type { DirtyWindow } from "../types";
import { extractStructuralWindow } from "../window-extractor";
import { extractDirtyFencedDivWindows } from "./fenced-div-slice";
import {
  buildEquationSlice,
  mapEquationSemantics,
  mergeEquationSlice,
  type EquationSlice,
} from "./equation-slice";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
}

function analyzeEquationSlice(state: EditorState): EquationSlice {
  const source = editorStateTextSource(state);
  return buildEquationSlice(extractStructuralWindow(source, fullTree(state)));
}

function expectEquationByIdMatchesSlice(slice: EquationSlice): void {
  expect(Array.from(slice.equationById.keys())).toEqual(
    slice.equations.map((equation) => equation.id),
  );

  for (const equation of slice.equations) {
    expect(slice.equationById.get(equation.id)).toBe(equation);
  }
}

function expandWindowsForEquations(
  dirtyWindows: readonly DirtyWindow[],
  equations: readonly { readonly from: number; readonly to: number }[],
  mapOldToNew: (pos: number, assoc?: number) => number,
): readonly DirtyWindow[] {
  if (equations.length === 0) return dirtyWindows;
  return dirtyWindows.map((window) => {
    let { fromOld, toOld, fromNew, toNew } = window;
    let expanded = false;
    for (const eq of equations) {
      if (eq.from <= toOld && fromOld < eq.to) {
        const mFrom = mapOldToNew(eq.from, 1);
        const mTo = Math.max(mFrom, mapOldToNew(eq.to, -1));
        fromOld = Math.min(fromOld, eq.from);
        toOld = Math.max(toOld, eq.to);
        fromNew = Math.min(fromNew, mFrom);
        toNew = Math.max(toNew, mTo);
        expanded = true;
      }
    }
    return expanded ? { fromOld, toOld, fromNew, toNew } : window;
  });
}

function mergeAndRebuild(
  state: EditorState,
  changes: ChangeSpec | readonly ChangeSpec[],
  before: EquationSlice = analyzeEquationSlice(state),
): { before: EquationSlice; after: EquationSlice; rebuilt: EquationSlice } {
  const tr = state.update({ changes });
  const rebuilt = analyzeEquationSlice(tr.state);
  const delta = buildSemanticDelta(tr);
  const source = editorStateTextSource(tr.state);
  const tree = fullTree(tr.state);
  const expandedWindows = expandWindowsForEquations(
    delta.dirtyWindows,
    before.equations,
    delta.mapOldToNew,
  );
  const extractedWindows = extractDirtyFencedDivWindows(
    [],
    source,
    tree,
    tr.changes,
    expandedWindows,
  );
  const dirtyExtractions = extractedWindows.map(({ window, range, structural }) => ({
    window: { ...window, fromNew: range.from, toNew: range.to },
    structural,
  }));
  const after = mergeEquationSlice(before, delta, dirtyExtractions);
  return { before, after, rebuilt };
}

describe("equation slice", () => {
  it("maps unchanged equation offsets through transaction changes", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
    ].join("\n");
    const state = createState(doc);
    const before = analyzeEquationSlice(state);
    const second = before.equations[1];
    const insert = "Lead paragraph.\n\n";
    const insertAt = doc.indexOf("$$y$$");
    const tr = state.update({
      changes: { from: insertAt, insert },
    });

    const mapped = mapEquationSemantics(second, tr.changes);

    expect(mapped).toEqual({
      ...second,
      from: second.from + insert.length,
      to: second.to + insert.length,
      labelFrom: second.labelFrom + insert.length,
      labelTo: second.labelTo + insert.length,
    });
    expect(mapped).not.toBe(second);
  });

  it("preserves unaffected prefix identity while renumbering the affected tail", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
      "",
      "$$z$$ {#eq:third}",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeEquationSlice(beforeState);
    const stablePrefix = before.equations[0];
    const renumberedSecond = before.equations[1];
    const { after, rebuilt } = mergeAndRebuild(beforeState, {
      from: doc.indexOf("$$y$$"),
      insert: "$$w$$ {#eq:middle}\n\n",
    }, before);

    expect(after.equations.map(({ id, number }) => ({ id, number }))).toEqual([
      { id: "eq:first", number: 1 },
      { id: "eq:middle", number: 2 },
      { id: "eq:second", number: 3 },
      { id: "eq:third", number: 4 },
    ]);
    expect(after).toEqual(rebuilt);
    expect(after.equations[0]).toBe(stablePrefix);
    expect(after.equations[2]).not.toBe(renumberedSecond);
    expectEquationByIdMatchesSlice(after);
  });

  it("preserves an unaffected suffix when editing one equation body", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
      "",
      "$$z$$ {#eq:third}",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeEquationSlice(beforeState);
    const stableFirst = before.equations[0];
    const updatedSecond = before.equations[1];
    const stableThird = before.equations[2];
    const from = doc.indexOf("$$y$$") + 2;
    const { after, rebuilt } = mergeAndRebuild(beforeState, {
      from,
      to: from + 1,
      insert: "w",
    }, before);

    expect(after).toEqual(rebuilt);
    expect(after.equations[0]).toBe(stableFirst);
    expect(after.equations[1]).not.toBe(updatedSecond);
    expect(after.equations[1]?.latex).toBe("w");
    expect(after.equations[2]).toBe(stableThird);
    expectEquationByIdMatchesSlice(after);
  });

  it("reuses the full slice when an unrelated edit happens after all equations", () => {
    const doc = [
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyzeEquationSlice(beforeState);
    const { after, rebuilt } = mergeAndRebuild(beforeState, {
      from: beforeState.doc.length,
      insert: "\n\nTail paragraph.",
    }, before);

    expect(after).toBe(before);
    expect(after).toEqual(rebuilt);
    expect(after.equations[0]).toBe(before.equations[0]);
    expect(after.equations[1]).toBe(before.equations[1]);
    expectEquationByIdMatchesSlice(after);
  });

  const boundaryScenarios: Array<{
    readonly title: string;
    readonly doc: string;
    readonly changes: ChangeSpec;
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
      changes: {
        from: "$$x$$ {#eq:first}\n\n$$y$$".length,
        to: "$$x$$ {#eq:first}\n\n$$y$$ {#eq:second}".length,
        insert: "",
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
      changes: {
        from: "$$x$$".length,
        to: "$$x$$ {#eq:first}\n\n$$y$$ {#eq:second}\n\n".length,
        insert: "\n\n$$y2$$ {#eq:second}\n\n",
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
      changes: {
        from: "Intro.\n\n".length,
        to: "Intro.\n\n$$".length,
        insert: "",
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
      changes: {
        from: 0,
        insert: "X",
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
      changes: {
        from: "[@cite]".length,
        to: "[@cite]\n\n".length,
        insert: "\n {#eq:edit}",
      },
      expected: [],
    },
    {
      title: "deleting a middle equation closer leaves later invalid closer text unpaired",
      doc: [
        "$$x$$ {#eq:first}",
        "",
        "$$y$$ {#eq:second}",
        "",
        "$$z$$ {#eq:third}",
      ].join("\n"),
      changes: {
        from: "$$x$$ {#eq:first}\n\n$$y".length,
        to: "$$x$$ {#eq:first}\n\n$$y$$".length,
        insert: "",
      },
      expected: [
        { id: "eq:first", number: 1 },
        { id: "eq:third", number: 2 },
      ],
    },
  ];

  for (const scenario of boundaryScenarios) {
    it(`matches a fresh rebuild when ${scenario.title}`, () => {
      const state = createState(scenario.doc);
      const { after, rebuilt } = mergeAndRebuild(state, scenario.changes);

      expect(after).toEqual(rebuilt);
      expect(after.equations.map(({ id, number }) => ({ id, number }))).toEqual(
        scenario.expected,
      );
      expectEquationByIdMatchesSlice(after);
    });
  }
});
