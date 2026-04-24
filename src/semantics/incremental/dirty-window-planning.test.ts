import { describe, expect, it } from "vitest";
import type { HeadingSemantics } from "../document-model";
import {
  classifyStructuralExtraction,
  expandDirtyWindows,
} from "./dirty-window-planning";
import {
  ZERO_REVISION_INFO,
  type IncrementalDocumentAnalysisState,
} from "./slice-registry";
import type { DirtyWindow, SemanticDelta } from "./types";

function dirtyWindow(fromOld: number, toOld: number): DirtyWindow {
  return {
    fromOld,
    toOld,
    fromNew: fromOld,
    toNew: toOld,
  };
}

function deltaForWindow(
  window: DirtyWindow,
  plainInlineTextOnlyChange = true,
): SemanticDelta {
  return {
    rawChangedRanges: [window],
    dirtyWindows: [window],
    docChanged: true,
    syntaxTreeChanged: false,
    frontmatterChanged: false,
    globalInvalidation: false,
    plainInlineTextOnlyChange,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
}

function headingRange(from: number, to: number): HeadingSemantics {
  return {
    from,
    to,
    level: 1,
    text: "Heading",
    number: "1",
    unnumbered: false,
  };
}

function incrementalState(
  overrides: Partial<IncrementalDocumentAnalysisState> = {},
): IncrementalDocumentAnalysisState {
  return {
    headingSlice: {
      headings: [],
      headingByFrom: new Map(),
    },
    footnoteSlice: {
      refs: [],
      definitions: [],
      defs: new Map(),
      refByFrom: new Map(),
      defByFrom: new Map(),
      numberById: new Map(),
      orderedEntries: [],
    },
    fencedDivSlice: {
      fencedDivs: [],
      fencedDivByFrom: new Map(),
      structureRanges: [],
    },
    equationSlice: {
      equations: [],
      equationById: new Map(),
    },
    mathSlice: {
      mathRegions: [],
    },
    referenceSlice: {
      bracketedReferences: [],
      narrativeReferences: [],
      references: [],
      referenceByFrom: new Map(),
    },
    revisions: ZERO_REVISION_INFO,
    excludedRanges: [],
    referenceIndex: new Map(),
    ...overrides,
  };
}

describe("dirty window planning", () => {
  it("treats inclusive boundary touches as excluded-range dirty coverage", () => {
    const windows = [dirtyWindow(10, 10)];
    const ranges = [{ from: 5, to: 10 }];

    expect(expandDirtyWindows(windows, ranges, (pos) => pos, false)).toBe(windows);
    expect(expandDirtyWindows(windows, ranges, (pos) => pos, true)).toEqual([
      {
        fromOld: 5,
        toOld: 10,
        fromNew: 5,
        toNew: 10,
      },
    ]);
  });

  it("classifies plain edits outside semantic owners as skippable", () => {
    const state = incrementalState({
      mathSlice: {
        mathRegions: [{
          from: 20,
          to: 25,
          isDisplay: false,
          contentFrom: 21,
          contentTo: 24,
          latex: "x",
        }],
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(1, 2))))
      .toBe("skip");
  });

  it("uses paragraph extraction for plain edits touching inline semantic owners", () => {
    const state = incrementalState({
      mathSlice: {
        mathRegions: [{
          from: 20,
          to: 25,
          isDisplay: false,
          contentFrom: 21,
          contentTo: 24,
          latex: "x",
        }],
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(22, 22))))
      .toBe("paragraph");
  });

  it("uses full structural extraction for edits touching structural owners", () => {
    const state = incrementalState({
      headingSlice: {
        headings: [headingRange(10, 20)],
        headingByFrom: new Map(),
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(12, 13))))
      .toBe("full");
  });

  it("uses full structural extraction for non-plain text changes", () => {
    const state = incrementalState();

    expect(
      classifyStructuralExtraction(
        state,
        deltaForWindow(dirtyWindow(1, 2), false),
      ),
    ).toBe("full");
  });
});
