import type { Tree } from "@lezer/common";
import type {
  DocumentAnalysis,
  FencedDivSemantics,
  IncludeSemantics,
  TextSource,
} from "../document";
import {
  buildEquationSlice,
  mergeEquationSlice,
  type EquationSlice,
} from "./slices/equation-slice";
import {
  extractDirtyFencedDivWindows,
  mergeFencedDivSlice,
} from "./slices/fenced-div-slice";
import {
  buildFootnoteSlice,
  mergeFootnoteSlice,
  type FootnoteSlice,
} from "./slices/footnote-slice";
import {
  buildHeadingSlice,
  mergeHeadingSlice,
  type HeadingSlice,
} from "./slices/heading-slice";
import { deriveIncludeSlice } from "./slices/include-slice";
import {
  buildMathSlice,
  mergeMathSlice,
  type MathSlice,
} from "./slices/math-slice";
import {
  buildReferenceSlice,
  mergeReferenceSlice,
  type ReferenceSlice,
} from "./slices/reference-slice";
import type { PositionMapper } from "./merge-utils";
import type { SemanticDelta } from "./types";
import { extractStructuralWindow } from "./window-extractor";

export interface DocumentAnalysisSliceRevisions {
  readonly headings: number;
  readonly footnotes: number;
  readonly fencedDivs: number;
  readonly equations: number;
  readonly mathRegions: number;
  readonly references: number;
  readonly includes: number;
}

export type DocumentAnalysisSliceName = keyof DocumentAnalysisSliceRevisions;

export interface DocumentAnalysisRevisionInfo {
  readonly revision: number;
  readonly slices: DocumentAnalysisSliceRevisions;
}

interface FencedDivSlice {
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly fencedDivByFrom: ReadonlyMap<number, FencedDivSemantics>;
}

interface IncludeSlice {
  readonly includes: readonly IncludeSemantics[];
  readonly includeByFrom: ReadonlyMap<number, IncludeSemantics>;
}

interface DocumentAnalysisSlices {
  readonly headingSlice: HeadingSlice;
  readonly footnoteSlice: FootnoteSlice;
  readonly fencedDivSlice: FencedDivSlice;
  readonly equationSlice: EquationSlice;
  readonly mathSlice: MathSlice;
  readonly referenceSlice: ReferenceSlice;
  readonly includeSlice: IncludeSlice;
}

interface InternalDocumentAnalysisState extends DocumentAnalysisSlices {
  readonly revisions: DocumentAnalysisRevisionInfo;
}

const ZERO_SLICE_REVISIONS: DocumentAnalysisSliceRevisions = Object.freeze({
  headings: 0,
  footnotes: 0,
  fencedDivs: 0,
  equations: 0,
  mathRegions: 0,
  references: 0,
  includes: 0,
});

const ZERO_REVISION_INFO: DocumentAnalysisRevisionInfo = Object.freeze({
  revision: 0,
  slices: ZERO_SLICE_REVISIONS,
});

const analysisStateSymbol = Symbol("documentAnalysisState");

type DocumentAnalysisWithInternalState = DocumentAnalysis & {
  readonly [analysisStateSymbol]?: InternalDocumentAnalysisState;
};

function createPositionMapper(
  delta: Pick<SemanticDelta, "mapOldToNew">,
): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

function reuseEquivalentArray<T>(
  previous: readonly T[],
  next: readonly T[],
): readonly T[] {
  if (
    previous.length === next.length
    && next.every((value, index) => value === previous[index])
  ) {
    return previous;
  }

  return next;
}

function createFencedDivSlice(
  fencedDivs: readonly FencedDivSemantics[],
): FencedDivSlice {
  return {
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
  };
}

function createIncludeSlice(
  includes: readonly IncludeSemantics[],
): IncludeSlice {
  return {
    includes,
    includeByFrom: new Map(includes.map((include) => [include.from, include])),
  };
}

function buildSlices(doc: TextSource, tree: Tree): DocumentAnalysisSlices {
  const structural = extractStructuralWindow(doc, tree);
  const fencedDivSlice = createFencedDivSlice(structural.fencedDivs);

  return {
    headingSlice: buildHeadingSlice(structural),
    footnoteSlice: buildFootnoteSlice(structural),
    fencedDivSlice,
    equationSlice: buildEquationSlice(structural),
    mathSlice: buildMathSlice(structural),
    referenceSlice: buildReferenceSlice(doc, structural),
    includeSlice: createIncludeSlice(
      deriveIncludeSlice(doc, fencedDivSlice.fencedDivs),
    ),
  };
}

function getInternalState(
  analysis: DocumentAnalysis,
): InternalDocumentAnalysisState | undefined {
  return (analysis as DocumentAnalysisWithInternalState)[analysisStateSymbol];
}

function withInternalState(
  analysis: DocumentAnalysis,
  state: InternalDocumentAnalysisState,
): DocumentAnalysis {
  Object.defineProperty(analysis, analysisStateSymbol, {
    value: state,
  });
  return analysis;
}

function buildRevisionInfo(
  previous: InternalDocumentAnalysisState | undefined,
  slices: DocumentAnalysisSlices,
): DocumentAnalysisRevisionInfo {
  if (!previous) {
    return ZERO_REVISION_INFO;
  }

  const slicesChanged = {
    headings: previous.headingSlice !== slices.headingSlice,
    footnotes: previous.footnoteSlice !== slices.footnoteSlice,
    fencedDivs: previous.fencedDivSlice !== slices.fencedDivSlice,
    equations: previous.equationSlice !== slices.equationSlice,
    mathRegions: previous.mathSlice !== slices.mathSlice,
    references: previous.referenceSlice !== slices.referenceSlice,
    includes: previous.includeSlice !== slices.includeSlice,
  } satisfies Record<DocumentAnalysisSliceName, boolean>;

  const nextSlices: DocumentAnalysisSliceRevisions = {
    headings: previous.revisions.slices.headings + Number(slicesChanged.headings),
    footnotes: previous.revisions.slices.footnotes + Number(slicesChanged.footnotes),
    fencedDivs: previous.revisions.slices.fencedDivs + Number(slicesChanged.fencedDivs),
    equations: previous.revisions.slices.equations + Number(slicesChanged.equations),
    mathRegions: previous.revisions.slices.mathRegions + Number(slicesChanged.mathRegions),
    references: previous.revisions.slices.references + Number(slicesChanged.references),
    includes: previous.revisions.slices.includes + Number(slicesChanged.includes),
  };

  return {
    revision: previous.revisions.revision + 1,
    slices: nextSlices,
  };
}

function sameSlices(
  previous: InternalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return (
    previous.headingSlice === next.headingSlice
    && previous.footnoteSlice === next.footnoteSlice
    && previous.fencedDivSlice === next.fencedDivSlice
    && previous.equationSlice === next.equationSlice
    && previous.mathSlice === next.mathSlice
    && previous.referenceSlice === next.referenceSlice
    && previous.includeSlice === next.includeSlice
  );
}

function finalizeDocumentAnalysis(
  previous: DocumentAnalysis | undefined,
  slices: DocumentAnalysisSlices,
): DocumentAnalysis {
  const previousState = previous ? getInternalState(previous) : undefined;
  if (previous && previousState && sameSlices(previousState, slices)) {
    return previous;
  }

  const revisions = buildRevisionInfo(previousState, slices);
  const analysis: DocumentAnalysis = {
    headings: slices.headingSlice.headings,
    headingByFrom: slices.headingSlice.headingByFrom,
    footnotes: slices.footnoteSlice,
    fencedDivs: slices.fencedDivSlice.fencedDivs,
    fencedDivByFrom: slices.fencedDivSlice.fencedDivByFrom,
    equations: slices.equationSlice.equations,
    equationById: slices.equationSlice.equationById,
    mathRegions: slices.mathSlice.mathRegions,
    references: slices.referenceSlice.references,
    referenceByFrom: slices.referenceSlice.referenceByFrom,
    includes: slices.includeSlice.includes,
    includeByFrom: slices.includeSlice.includeByFrom,
  };

  return withInternalState(analysis, {
    ...slices,
    revisions,
  });
}

export function createDocumentAnalysis(
  doc: TextSource,
  tree: Tree,
): DocumentAnalysis {
  return finalizeDocumentAnalysis(undefined, buildSlices(doc, tree));
}

export function updateDocumentAnalysis(
  previous: DocumentAnalysis,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentAnalysis {
  const previousState = getInternalState(previous);
  if (!previousState) {
    return createDocumentAnalysis(doc, tree);
  }

  if (!delta.docChanged) {
    if (!delta.syntaxTreeChanged && !delta.globalInvalidation) {
      return previous;
    }
    return finalizeDocumentAnalysis(previous, buildSlices(doc, tree));
  }

  if (delta.globalInvalidation || delta.dirtyWindows.length === 0) {
    return finalizeDocumentAnalysis(previous, buildSlices(doc, tree));
  }

  const changes = createPositionMapper(delta);
  const extractedDirtyWindows = extractDirtyFencedDivWindows(
    previousState.fencedDivSlice.fencedDivs,
    doc,
    tree,
    changes,
    delta.dirtyWindows,
  );
  const dirtyExtractions = extractedDirtyWindows.map(({ window, range, structural }) => ({
    window: {
      ...window,
      fromNew: range.from,
      toNew: range.to,
    },
    structural,
  }));

  const headingSlice = mergeHeadingSlice(
    previousState.headingSlice,
    delta,
    dirtyExtractions,
  );
  const footnoteSlice = mergeFootnoteSlice(
    previousState.footnoteSlice,
    delta,
    dirtyExtractions,
  );
  const mergedFencedDivs = reuseEquivalentArray(
    previousState.fencedDivSlice.fencedDivs,
    mergeFencedDivSlice(
      previousState.fencedDivSlice.fencedDivs,
      changes,
      extractedDirtyWindows,
    ),
  );
  const fencedDivSlice = mergedFencedDivs === previousState.fencedDivSlice.fencedDivs
    ? previousState.fencedDivSlice
    : createFencedDivSlice(mergedFencedDivs);
  const includes = reuseEquivalentArray(
    previousState.includeSlice.includes,
    deriveIncludeSlice(
      doc,
      fencedDivSlice.fencedDivs,
      previousState.includeSlice.includes,
      changes,
    ),
  );
  const includeSlice = includes === previousState.includeSlice.includes
    ? previousState.includeSlice
    : createIncludeSlice(includes);
  const mathSlice = mergeMathSlice(
    previousState.mathSlice,
    delta,
    dirtyExtractions,
  );
  const globalStructural = extractStructuralWindow(doc, tree);
  const equationSlice = mergeEquationSlice(
    previousState.equationSlice,
    buildEquationSlice(globalStructural).equations,
    changes,
  );
  const referenceSlice = mergeReferenceSlice(
    previousState.referenceSlice,
    doc,
    delta,
    dirtyExtractions,
    globalStructural,
  );

  return finalizeDocumentAnalysis(previous, {
    headingSlice,
    footnoteSlice,
    fencedDivSlice,
    equationSlice,
    mathSlice,
    referenceSlice,
    includeSlice,
  });
}

export function getDocumentAnalysisRevisionInfo(
  analysis: DocumentAnalysis,
): DocumentAnalysisRevisionInfo {
  return getInternalState(analysis)?.revisions ?? ZERO_REVISION_INFO;
}

export function getDocumentAnalysisRevision(
  analysis: DocumentAnalysis,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).revision;
}

export function getDocumentAnalysisSliceRevision(
  analysis: DocumentAnalysis,
  slice: DocumentAnalysisSliceName,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).slices[slice];
}
