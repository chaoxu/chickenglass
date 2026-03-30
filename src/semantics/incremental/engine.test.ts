import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
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

function analyze(state: EditorState) {
  return createDocumentAnalysis(editorStateTextSource(state), fullTree(state));
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
    expect(getDocumentAnalysisSliceRevision(after, "includes")).toBe(
      getDocumentAnalysisSliceRevision(before, "includes"),
    );
    expect(after.headings).toBe(before.headings);
    expect(after.mathRegions[0]).not.toBe(before.mathRegions[0]);
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
    // "foo $bar\n@baz\n$ qux".  The old 3-line InlineMath shrinks to a
    // short span on line 1 ("$oo $"), exposing @baz on line 2.
    // Without paragraph-scope expansion, the narrative extraction covers
    // only line 1 and never re-scans @baz.
    const state = createState([
      "foo $bar",
      "@baz",
      "$ qux",
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
});
