import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../parser";
import { ensureFullSyntaxTree } from "../../test-utils";
import { editorStateTextSource } from "../../state/document-analysis";
import { getEquationNumbersCacheKey, type DocumentAnalysis } from "../document";
import { buildSemanticDelta } from "./semantic-delta";
import type { SemanticDelta } from "./types";
import {
  createDocumentAnalysis,
  createDocumentAnalysisSnapshot,
  createDocumentArtifacts,
  type DocumentAnalysisSnapshot,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
  updateDocumentArtifacts,
  updateDocumentAnalysis,
} from "./engine";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
}

function analyze(state: EditorState) {
  return createDocumentAnalysisSnapshot(editorStateTextSource(state), fullTree(state));
}

function analyzeArtifacts(state: EditorState) {
  return createDocumentArtifacts(editorStateTextSource(state), fullTree(state));
}

function expectAnalysisMatchesRebuild(
  after: DocumentAnalysis,
  rebuilt: DocumentAnalysis,
): void {
  expect(after.headings).toEqual(rebuilt.headings);
  expect(after.footnotes).toEqual(rebuilt.footnotes);
  expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
  expect(after.equations).toEqual(rebuilt.equations);
  expect(after.mathRegions).toEqual(rebuilt.mathRegions);
  expect(after.references).toEqual(rebuilt.references);
  expect(Array.from(after.referenceIndex.entries())).toEqual(
    Array.from(rebuilt.referenceIndex.entries()),
  );
}

interface RangeProbe {
  readonly from: number;
  readonly to: number;
}

interface InternalStateProbe {
  readonly fencedDivSlice: {
    readonly structureRanges: readonly RangeProbe[];
  };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isInternalStateProbe(value: unknown): value is InternalStateProbe {
  if (!isRecord(value)) return false;
  const fencedDivSlice = value.fencedDivSlice;
  return isRecord(fencedDivSlice) && Array.isArray(fencedDivSlice.structureRanges);
}

function getInternalStateProbe(analysis: DocumentAnalysisSnapshot): InternalStateProbe {
  const value = analysis.incrementalState;
  if (isInternalStateProbe(value)) {
    return value;
  }
  throw new Error("expected incremental analysis internal state");
}

function identityDirtyDelta(
  dirtyWindow: SemanticDelta["dirtyWindows"][number],
): SemanticDelta {
  return {
    rawChangedRanges: [],
    dirtyWindows: [dirtyWindow],
    docChanged: true,
    syntaxTreeChanged: false,
    frontmatterChanged: false,
    globalInvalidation: false,
    plainInlineTextOnlyChange: true,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
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
      fullTree(tr.state),
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
      fullTree(tr.state),
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
    expect(after.headings).toBe(before.headings);
    expect(after.mathRegions[0]).not.toBe(before.mathRegions[0]);
  });

  it("matches a full rebuild for plain prose inserts before later structural syntax", () => {
    const state = createState([
      "Intro paragraph.",
      "",
      "Still plain prose.",
      "",
      "::: {.theorem #thm:one} Title",
      "Body",
      ":::",
      "",
      "See [@thm:one] and $x$.",
    ].join("\n"));
    const before = analyze(state);
    const insertPos = state.doc.toString().indexOf("plain prose");
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "1" },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = analyze(tr.state);

    expect(after.headings).toEqual(rebuilt.headings);
    expect(after.footnotes).toEqual(rebuilt.footnotes);
    expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
    expect(after.equations).toEqual(rebuilt.equations);
    expect(after.mathRegions).toEqual(rebuilt.mathRegions);
    expect(after.references).toEqual(rebuilt.references);
  });

  it("matches a full rebuild for plain prose inserts inside a fenced block body", () => {
    const state = createState([
      "::: {.theorem #thm:one} Sample",
      "Body with $x$ and [@thm:one] inside the fenced block.",
      "Second prose line in the same block.",
      ":::",
      "",
      "Tail paragraph.",
    ].join("\n"));
    const before = analyze(state);
    const insertPos = state.doc.toString().indexOf("Second prose");
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "local " },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = analyze(tr.state);

    expect(after.headings).toEqual(rebuilt.headings);
    expect(after.footnotes).toEqual(rebuilt.footnotes);
    expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
    expect(after.equations).toEqual(rebuilt.equations);
    expect(after.mathRegions).toEqual(rebuilt.mathRegions);
    expect(after.references).toEqual(rebuilt.references);
  });

  it.each([
    {
      label: "outer id",
      target: "#thm:outer",
      replacement: "#thm:outer-updated",
    },
    {
      label: "outer title",
      target: "Outer Title",
      replacement: "Outer Result",
    },
    {
      label: "inner id",
      target: "#def:inner",
      replacement: "#def:inner-updated",
    },
    {
      label: "inner title",
      target: "Inner Title",
      replacement: "Inner Result",
    },
  ])("matches a full rebuild after editing nested fenced-div $label", ({
    target,
    replacement,
  }) => {
    const doc = [
      ":::: {.theorem #thm:outer} Outer Title",
      "Outer body.",
      "::: {.definition #def:inner} Inner Title",
      "Inner body.",
      ":::",
      "::::",
      "",
      "See [@thm:outer] and [@def:inner].",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);
    const from = doc.indexOf(target);
    const tr = state.update({
      changes: {
        from,
        to: from + target.length,
        insert: replacement,
      },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = analyze(tr.state);

    expectAnalysisMatchesRebuild(after, rebuilt);
  });

  it("matches a full rebuild after editing before a fenced-div opener attribute", () => {
    const doc = [
      "::: {.theorem #thm:one} Title",
      "Body.",
      ":::",
      "",
      "See [@thm:one].",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);
    const from = doc.indexOf("{.theorem") - 1;
    const tr = state.update({
      changes: {
        from,
        insert: "x",
      },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = analyze(tr.state);

    expectAnalysisMatchesRebuild(after, rebuilt);
  });

  it("matches a full rebuild for plain prose inserts before later inline refs in the same paragraph", () => {
    const state = createState(
      "Lead prose here before [@sec:one] and $x$ later in the same paragraph.",
    );
    const before = analyze(state);
    const insertPos = state.doc.toString().indexOf("before");
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "plain " },
    });

    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = analyze(tr.state);

    expect(after.headings).toEqual(rebuilt.headings);
    expect(after.footnotes).toEqual(rebuilt.footnotes);
    expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
    expect(after.equations).toEqual(rebuilt.equations);
    expect(after.mathRegions).toEqual(rebuilt.mathRegions);
    expect(after.references).toEqual(rebuilt.references);
  });

  it("refreshes IR section ranges when a tail edit reuses the prior analysis", () => {
    const state = createState([
      "# Intro",
      "",
      "Alpha.",
    ].join("\n"));
    const before = analyzeArtifacts(state);
    const tr = state.update({
      changes: {
        from: state.doc.length,
        insert: "\n\nTail paragraph.",
      },
    });

    const after = updateDocumentArtifacts(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    expect(after.analysis).toBe(before.analysis);
    expect(before.ir.sections[0]?.range.to).toBe(state.doc.length);
    expect(after.ir.sections[0]?.range.to).toBe(tr.state.doc.length);
    expect(after.ir.sections[0]?.range.to).toBeGreaterThan(
      before.ir.sections[0]?.range.to ?? 0,
    );
  });

  it("refreshes IR tables when table edits leave the analysis unchanged", () => {
    const state = createState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
    ].join("\n"));
    const before = analyzeArtifacts(state);
    const cellPos = state.doc.toString().indexOf("1");
    const tr = state.update({
      changes: {
        from: cellPos,
        to: cellPos + 1,
        insert: "9",
      },
    });

    const after = updateDocumentArtifacts(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    expect(after.analysis).toBe(before.analysis);
    expect(before.ir.tables[0]?.rows[0]?.cells[0]?.content).toBe("1");
    expect(after.ir.tables[0]?.rows[0]?.cells[0]?.content).toBe("9");
  });

  it("does not crash when an exclusion-only edit is followed by a second edit", () => {
    // Repro: delete the opening backtick of an inline code span that hides a
    // reference, then insert elsewhere.  If the engine caches stale
    // excludedRanges the second mapExcludedRanges call hits a RangeError.
    const state = createState("`@x`\n");
    const before = analyze(state);

    // Step 1: delete positions 0..2 → "x`\n"
    const tr1 = state.update({ changes: { from: 0, to: 2 } });
    const mid = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr1.state),
      fullTree(tr1.state),
      buildSemanticDelta(tr1),
    );

    // Step 2: insert "@" at position 0 → "@x`\n"
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "@" } });
    expect(() =>
      updateDocumentAnalysis(
        mid,
        editorStateTextSource(tr2.state),
        fullTree(tr2.state),
        buildSemanticDelta(tr2),
      ),
    ).not.toThrow();
  });

  it("updates narrative references when only exclusion metadata changes", () => {
    // Repro: widen an inline code span so that a previously-visible @ref
    // becomes hidden, then narrow it again.  The engine must track the
    // exclusion change even when no slice reference-identity changes.
    const state = createState("`@x`\n");
    const before = analyze(state);

    // Step 1: insert "x" at position 2 → "`@xx`\n"
    const tr1 = state.update({ changes: { from: 2, insert: "x" } });
    const mid = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr1.state),
      fullTree(tr1.state),
      buildSemanticDelta(tr1),
    );

    // Step 2: insert "`" at position 0 → "``@xx`\n"
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "`" } });
    const after = updateDocumentAnalysis(
      mid,
      editorStateTextSource(tr2.state),
      fullTree(tr2.state),
      buildSemanticDelta(tr2),
    );

    // A fresh rebuild from the final state is the correctness oracle.
    const rebuilt = analyze(tr2.state);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("preserves narrative references when editing inside the @id token", () => {
    // Repro from PR #693 review: replace the "p" in "@alpha" with "P".
    // Without dirty-window expansion the window covers only the changed
    // character, the regex finds no match, and the old ref is removed.
    const state = createState("See @alpha ref.");
    const before = analyze(state);
    expect(before.references.length).toBe(1);
    expect(before.references[0]).toEqual(
      expect.objectContaining({ ids: ["alpha"], bracketed: false }),
    );

    const pPos = state.doc.toString().indexOf("p", state.doc.toString().indexOf("@alpha"));
    const tr = state.update({
      changes: { from: pPos, to: pPos + 1, insert: "P" },
    });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("detects a narrative reference created by inserting @ before plain text", () => {
    // Repro from PR #693 review (round 2): insert "@" before "beta".
    // Without line-boundary expansion the dirty window covers only the
    // inserted "@", the regex can't see "beta", and no ref is found.
    const state = createState("See beta ref.");
    const before = analyze(state);
    expect(before.references.length).toBe(0);

    const pos = state.doc.toString().indexOf("beta");
    const tr = state.update({ changes: { from: pos, insert: "@" } });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(rebuilt.references.length).toBe(1);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("extends a narrative reference when appending to its trailing boundary", () => {
    // Repro from PR #693 review (round 2): insert "a" after "@bet".
    // Without line-boundary expansion the dirty window is at the boundary
    // of the old token, the regex finds only the old "@bet" extent, and
    // the updated "@beta" is missed.
    const state = createState("See @bet ref.");
    const before = analyze(state);
    expect(before.references.length).toBe(1);
    expect(before.references[0]).toEqual(
      expect.objectContaining({ ids: ["bet"], bracketed: false }),
    );

    const insertPos = state.doc.toString().indexOf("@bet") + "@bet".length;
    const tr = state.update({ changes: { from: insertPos, insert: "a" } });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(rebuilt.references.length).toBe(1);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("keeps narrative references inside display math excluded after incremental edits", () => {
    const doc = [
      "$$",
      "@hidden",
      "$$",
      "",
      "See @visible.",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);

    expect(before.references.map((reference) => reference.ids[0])).toEqual([
      "visible",
    ]);

    const insertPos = doc.indexOf("hidden") + "hidden".length;
    const tr = state.update({
      changes: { from: insertPos, insert: "2" },
    });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(after.references.map((reference) => reference.ids[0])).toEqual([
      "visible",
    ]);
    expectAnalysisMatchesRebuild(after, rebuilt);
  });

  it("exposes a narrative ref when a delimiter edit reclassifies excluded regions", () => {
    // Repro from PR #693 review (round 3): insert a backtick before "h" in
    // "Math $@skip$ and `@code`." so the line becomes
    // "Mat`h $@skip$ and `@code`." — the first backtick now pairs with the
    // backtick before @code, making @code plain text instead of inline code.
    // Without fresh tree-based excluded ranges, mergeExcludedRanges keeps
    // the stale `@code` exclusion and the narrative ref is filtered out.
    const state = createState([
      "See @alpha and @beta.",
      "",
      "Math $@skip$ and `@code`.",
    ].join("\n"));
    const before = analyze(state);

    const insertPos = state.doc.toString().indexOf("h $@skip");
    const tr = state.update({ changes: { from: insertPos, insert: "`" } });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(rebuilt.references.length).toBeGreaterThanOrEqual(3);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("excludes a narrative ref when a delimiter edit creates a multi-line code span", () => {
    // Repro from PR #693 review (round 4): insert a backtick before "code"
    // so a new InlineCode span covers lines 1–2, hiding @hidden.
    // Without expanding the narrative extraction range beyond the edit line,
    // the incremental path still returns @hidden.
    const state = createState([
      "Start code",
      "@hidden` end",
      "tail",
    ].join("\n"));
    const before = analyze(state);

    const insertPos = state.doc.toString().indexOf("code");
    const tr = state.update({ changes: { from: insertPos, insert: "`" } });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("exposes a narrative ref when a delimiter edit shrinks a multi-line exclusion", () => {
    // Repro from PR #693 review (round 5): insert "$" at offset 1 in
    // "foo$bar\n@baz\nqux$ tail".  The old 3-line InlineMath shrinks to a
    // short span on line 1 ("$oo$"), exposing @baz on line 2.
    // Without paragraph-scope expansion, the narrative extraction covers
    // only line 1 and never re-scans @baz.
    const state = createState([
      "foo$bar",
      "@baz",
      "qux$ tail",
    ].join("\n"));
    const before = analyze(state);
    expect(before.references.length).toBe(0);

    const tr = state.update({ changes: { from: 1, insert: "$" } });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(rebuilt.references.length).toBeGreaterThanOrEqual(1);
    expect(after.references.length).toBe(rebuilt.references.length);
    for (let i = 0; i < rebuilt.references.length; i++) {
      expect(after.references[i]).toEqual(rebuilt.references[i]);
    }
  });

  it("keeps revisions off the public enumerable DocumentAnalysis shape", () => {
    const state = createState("Alpha $x$.");
    const analysis = createDocumentAnalysis(editorStateTextSource(state), fullTree(state));
    const snapshot = analyze(state);

    expect(Object.keys(analysis).sort()).toEqual([
      "equationById",
      "equations",
      "fencedDivByFrom",
      "fencedDivs",
      "footnotes",
      "headingByFrom",
      "headings",
      "mathRegions",
      "referenceByFrom",
      "referenceIndex",
      "references",
    ]);
    expect("revision" in analysis).toBe(false);
    expect("incrementalState" in snapshot).toBe(true);
    expect(Object.keys(snapshot)).not.toContain("incrementalState");
    expect(snapshot.analysis).toBeDefined();
  });

  it("caches equation numbering keys without exposing them as enumerable state", () => {
    const analysis = analyze(createState([
      "$$x$$ {#eq:first}",
      "",
      "$$y$$ {#eq:second}",
    ].join("\n"))).analysis;

    const cacheKey = getEquationNumbersCacheKey(analysis);
    const descriptor = Object.getOwnPropertyDescriptor(analysis, "equationNumbersCacheKey");

    expect(getEquationNumbersCacheKey(analysis)).toBe(cacheKey);
    expect(cacheKey.length).toBeGreaterThan(0);
    expect(descriptor?.enumerable).toBe(false);
    expect(Object.keys(analysis)).not.toContain("equationNumbersCacheKey");
  });

  it("correctly expands dirty windows with many equations (binary-search regression)", () => {
    const equationCount = 100;
    const lines: string[] = ["# Many equations", ""];
    for (let i = 0; i < equationCount; i++) {
      lines.push(`$$x_{${i}}$$ {#eq:e${i}}`, "");
    }
    lines.push("Tail.");
    const doc = lines.join("\n");

    const state = createState(doc);
    const before = analyze(state);
    // Parser may not find all equations in a single synchronous parse;
    // just verify we got a substantial number for a meaningful test.
    expect(before.equations.length).toBeGreaterThan(50);

    // Edit inside an equation near the middle of the parsed range.
    const midIdx = Math.floor(before.equations.length / 2);
    const midEq = before.equations[midIdx];
    const editPos = midEq.from + 2;
    const tr = state.update({
      changes: { from: editPos, to: editPos + 1, insert: "Z" },
    });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);
    expect(after.equations.length).toBe(rebuilt.equations.length);
    for (let i = 0; i < rebuilt.equations.length; i++) {
      expect(after.equations[i]).toEqual(rebuilt.equations[i]);
    }
    expect(after.mathRegions.length).toBe(rebuilt.mathRegions.length);
  });

  it("stops source-range dirty scans once ranges are past the dirty window", () => {
    const state = createState("Plain prose before later structure.");
    const before = analyze(state);
    const internalState = getInternalStateProbe(before);
    let postWindowRangeReads = 0;
    const postWindowRanges: RangeProbe[] = Array.from({ length: 200 }, (_, index) => {
      const from = 100 + index * 3;
      const range: RangeProbe = { from, to: from + 1 };
      Object.defineProperty(range, "from", {
        get() {
          postWindowRangeReads += 1;
          return from;
        },
      });
      return range;
    });

    Object.defineProperty(internalState.fencedDivSlice, "structureRanges", {
      value: [
        { from: 0, to: 4 },
        { from: 20, to: 21 },
        ...postWindowRanges,
      ],
    });

    const dirtyWindow = {
      fromOld: 10,
      toOld: 11,
      fromNew: 10,
      toNew: 11,
    };
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(state),
      fullTree(state),
      identityDirtyDelta(dirtyWindow),
    );
    const rebuilt = analyze(state);

    expect(postWindowRangeReads).toBe(0);
    expectAnalysisMatchesRebuild(after, rebuilt);
  });

  it("re-extracts equations in the math overhang after inserting a closing $$ (#778)", () => {
    // Reviewer repro: the multi-line $$ pairs with the $$ at line start of
    // "$$a$$", so eq:first is hidden (the "a$$ {#eq:first}" is leftover text).
    // Inserting "$$\n\n" before "$$a$$" makes the multi-line $$ close properly,
    // revealing $$a$$ as a separate equation block.  The mapped math region
    // extends past the dirty window (overhang), and the equation slice must
    // re-extract the overhang to discover eq:first.
    const doc = [
      "Intro.",
      "",
      "$$",
      "broken",
      "",
      "$$a$$ {#eq:first}",
      "",
      "$$b$$ {#eq:second}",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);

    // Before: only eq:second is visible (eq:first is hidden by the $$-pairing).
    expect(before.equations.length).toBe(1);
    expect(before.equations[0].id).toBe("eq:second");

    // Insert "$$\n\n" right before "$$a$$" to close the multi-line block.
    const insertPos = doc.indexOf("$$a$$");
    const tr = state.update({
      changes: { from: insertPos, insert: "$$\n\n" },
    });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);

    // Math regions must match a fresh rebuild.
    expect(after.mathRegions.length).toBe(rebuilt.mathRegions.length);
    for (let i = 0; i < rebuilt.mathRegions.length; i++) {
      expect(after.mathRegions[i]).toEqual(rebuilt.mathRegions[i]);
    }

    // Equations must also match — both eq:first and eq:second should be
    // present with correct numbering.
    expect(after.equations.length).toBe(rebuilt.equations.length);
    for (let i = 0; i < rebuilt.equations.length; i++) {
      expect(after.equations[i]).toEqual(rebuilt.equations[i]);
    }
  });

  it("does not duplicate mathRegions in a multi-range transaction closing $$ and appending text (#780)", () => {
    // Regression: in a transaction with two changes — one that inserts a
    // closing $$ (which collapses a BigUnclosed region and triggers overhang
    // re-extraction) and one that appends new text — the overhang extraction
    // window uses an inclusive boundary while replaceOverlappingRanges uses
    // a strict-overlap boundary.  A math region whose `from` equals
    // `overhangTo` (the right edge of the overhang window) survives the
    // remove step but is also emitted by the extractor, producing a
    // duplicate entry in mathRegions.
    const doc = [
      "Intro.",
      "",
      "$$",
      "broken",
      "",
      "$$a$$ {#eq:first}",
      "",
      "$$b$$ {#eq:second}",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);

    // Before: only eq:second is visible (eq:first is swallowed by the $$-pairing).
    expect(before.equations.length).toBe(1);

    // Two changes in a single transaction:
    //   1. Insert "$$\n\n" to close the multi-line block (dirty window W1).
    //   2. Append "\n\n$$c$$" to add a new equation at the end (dirty window W2).
    const insertPos = doc.indexOf("$$a$$");
    const appendPos = doc.length;
    const tr = state.update({
      changes: [
        { from: insertPos, insert: "$$\n\n" },
        { from: appendPos, insert: "\n\n$$c$$" },
      ],
    });
    const after = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );

    const rebuilt = analyze(tr.state);

    // mathRegions must match a fresh rebuild exactly — no duplicates.
    expect(after.mathRegions.length).toBe(rebuilt.mathRegions.length);
    for (let i = 0; i < rebuilt.mathRegions.length; i++) {
      expect(after.mathRegions[i]).toEqual(rebuilt.mathRegions[i]);
    }

    // Equations must also match — eq:first, eq:second, and the new $$c$$ (if
    // it has a label) should all be present.
    expect(after.equations.length).toBe(rebuilt.equations.length);
    for (let i = 0; i < rebuilt.equations.length; i++) {
      expect(after.equations[i]).toEqual(rebuilt.equations[i]);
    }
  });

  it("rebuilds the full paragraph when inline math delimiters re-pair later spans (#813)", () => {
    const doc = "Lead $a$ text $b$ more $c$ tail $d$ done.";
    const beforeState = createState(doc);
    const before = analyze(beforeState);
    const beforeB = doc.indexOf("$b$");

    const tr1 = beforeState.update({
      changes: { from: beforeB, insert: "$" },
    });
    const after1 = updateDocumentAnalysis(
      before,
      editorStateTextSource(tr1.state),
      fullTree(tr1.state),
      buildSemanticDelta(tr1),
    );

    const tr2 = tr1.state.update({
      changes: { from: beforeB + 1, insert: "x" },
    });
    const after2 = updateDocumentAnalysis(
      after1,
      editorStateTextSource(tr2.state),
      fullTree(tr2.state),
      buildSemanticDelta(tr2),
    );

    const tr3 = tr2.state.update({
      changes: { from: beforeB + 2, insert: "$" },
    });
    const after3 = updateDocumentAnalysis(
      after2,
      editorStateTextSource(tr3.state),
      fullTree(tr3.state),
      buildSemanticDelta(tr3),
    );

    const rebuilt = analyze(tr3.state);
    expect(after3.mathRegions.map((region) => region.latex)).toEqual([
      "a",
      "x",
      "b",
      "c",
      "d",
    ]);
    expect(after3.mathRegions.length).toBe(rebuilt.mathRegions.length);
    for (let i = 0; i < rebuilt.mathRegions.length; i++) {
      expect(after3.mathRegions[i]).toEqual(rebuilt.mathRegions[i]);
    }
  });
});
