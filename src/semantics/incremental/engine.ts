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
  type NarrativeRefExtraction,
  type ReferenceSlice,
} from "./slices/reference-slice";
import {
  mapRangeObject,
  replaceOverlappingRanges,
  type PositionMapper,
} from "./merge-utils";
import type { DirtyWindow, SemanticDelta } from "./types";
import type { ReferenceSemantics } from "../document";
import {
  collectNarrativeRefsInWindow,
  computeNarrativeExtractionRange,
  extractStructuralWindow,
  type ExcludedRange,
  type StructuralWindowExtraction,
} from "./window-extractor";

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

interface SliceRegistryEntry {
  readonly revisionKey: DocumentAnalysisSliceName;
  readonly sliceKey: keyof DocumentAnalysisSlices;
  readonly project: (
    slice: DocumentAnalysisSlices[keyof DocumentAnalysisSlices],
  ) => Partial<DocumentAnalysis>;
}

function sliceEntry<SK extends keyof DocumentAnalysisSlices>(
  revisionKey: DocumentAnalysisSliceName,
  sliceKey: SK,
  project: (slice: DocumentAnalysisSlices[SK]) => Partial<DocumentAnalysis>,
): SliceRegistryEntry {
  return {
    revisionKey,
    sliceKey,
    project: project as SliceRegistryEntry["project"],
  };
}

const SLICE_REGISTRY: readonly SliceRegistryEntry[] = [
  sliceEntry("headings", "headingSlice", (s) => ({
    headings: s.headings,
    headingByFrom: s.headingByFrom,
  })),
  sliceEntry("footnotes", "footnoteSlice", (s) => ({
    footnotes: s,
  })),
  sliceEntry("fencedDivs", "fencedDivSlice", (s) => ({
    fencedDivs: s.fencedDivs,
    fencedDivByFrom: s.fencedDivByFrom,
  })),
  sliceEntry("equations", "equationSlice", (s) => ({
    equations: s.equations,
    equationById: s.equationById,
  })),
  sliceEntry("mathRegions", "mathSlice", (s) => ({
    mathRegions: s.mathRegions,
  })),
  sliceEntry("references", "referenceSlice", (s) => ({
    references: s.references,
    referenceByFrom: s.referenceByFrom,
  })),
  sliceEntry("includes", "includeSlice", (s) => ({
    includes: s.includes,
    includeByFrom: s.includeByFrom,
  })),
];

interface InternalDocumentAnalysisState extends DocumentAnalysisSlices {
  readonly revisions: DocumentAnalysisRevisionInfo;
  readonly excludedRanges: readonly ExcludedRange[];
}

const ZERO_SLICE_REVISIONS = Object.freeze(
  Object.fromEntries(
    SLICE_REGISTRY.map(({ revisionKey }) => [revisionKey, 0]),
  ) as unknown as DocumentAnalysisSliceRevisions,
);

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

interface FullBuildResult {
  readonly slices: DocumentAnalysisSlices;
  readonly excludedRanges: readonly ExcludedRange[];
}

function buildSlicesAndExcludedRanges(doc: TextSource, tree: Tree): FullBuildResult {
  const structural = extractStructuralWindow(doc, tree);
  const fencedDivSlice = createFencedDivSlice(structural.fencedDivs);

  return {
    slices: {
      headingSlice: buildHeadingSlice(structural),
      footnoteSlice: buildFootnoteSlice(structural),
      fencedDivSlice,
      equationSlice: buildEquationSlice(structural),
      mathSlice: buildMathSlice(structural),
      referenceSlice: buildReferenceSlice(structural),
      includeSlice: createIncludeSlice(
        deriveIncludeSlice(doc, fencedDivSlice.fencedDivs),
      ),
    },
    excludedRanges: structural.excludedRanges,
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

  const nextSlices = Object.fromEntries(
    SLICE_REGISTRY.map(({ revisionKey, sliceKey }) => [
      revisionKey,
      previous.revisions.slices[revisionKey]
        + Number(previous[sliceKey] !== slices[sliceKey]),
    ]),
  ) as unknown as DocumentAnalysisSliceRevisions;

  return {
    revision: previous.revisions.revision + 1,
    slices: nextSlices,
  };
}

function sameSlices(
  previous: InternalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return SLICE_REGISTRY.every(({ sliceKey }) =>
    previous[sliceKey] === next[sliceKey],
  );
}

function finalizeDocumentAnalysis(
  previous: DocumentAnalysis | undefined,
  slices: DocumentAnalysisSlices,
  excludedRanges: readonly ExcludedRange[],
): DocumentAnalysis {
  const previousState = previous ? getInternalState(previous) : undefined;
  if (
    previous && previousState
    && sameSlices(previousState, slices)
    && previousState.excludedRanges === excludedRanges
  ) {
    return previous;
  }

  const revisions = buildRevisionInfo(previousState, slices);
  const analysis = {} as DocumentAnalysis;
  for (const { sliceKey, project } of SLICE_REGISTRY) {
    Object.assign(analysis, project(slices[sliceKey]));
  }

  return withInternalState(analysis, {
    ...slices,
    revisions,
    excludedRanges,
  });
}

export function createDocumentAnalysis(
  doc: TextSource,
  tree: Tree,
): DocumentAnalysis {
  const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
  return finalizeDocumentAnalysis(undefined, slices, excludedRanges);
}

function mapExcludedRanges(
  values: readonly ExcludedRange[],
  changes: PositionMapper,
): readonly ExcludedRange[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapRangeObject(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function expandDirtyWindows(
  dirtyWindows: readonly DirtyWindow[],
  previousRanges: readonly { readonly from: number; readonly to: number }[],
  mapOldToNew: (pos: number, assoc?: number) => number,
  touchingInclusive: boolean,
): readonly DirtyWindow[] {
  if (previousRanges.length === 0) return dirtyWindows;

  let anyExpanded = false;
  const result = dirtyWindows.map((window) => {
    let { fromOld, toOld, fromNew, toNew } = window;
    let expanded = false;

    for (const range of previousRanges) {
      const overlaps = touchingInclusive
        ? range.from <= toOld && fromOld <= range.to
        : range.from <= toOld && fromOld < range.to;
      if (overlaps) {
        const mappedFrom = mapOldToNew(range.from, -1);
        const mappedTo = Math.max(mappedFrom, mapOldToNew(range.to, 1));
        fromOld = Math.min(fromOld, range.from);
        toOld = Math.max(toOld, range.to);
        fromNew = Math.min(fromNew, mappedFrom);
        toNew = Math.max(toNew, mappedTo);
        expanded = true;
      }
    }

    if (expanded) anyExpanded = true;
    return expanded ? { fromOld, toOld, fromNew, toNew } : window;
  });

  return anyExpanded ? result : dirtyWindows;
}

interface DirtyExcludedRangesExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "excludedRanges">;
}

function mergeExcludedRanges(
  previous: readonly ExcludedRange[],
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyExcludedRangesExtraction[],
): readonly ExcludedRange[] {
  let ranges = mapExcludedRanges(previous, createPositionMapper(delta));
  for (const { window, structural } of dirtyExtractions) {
    ranges = replaceOverlappingRanges(
      ranges,
      { from: window.fromNew, to: window.toNew },
      structural.excludedRanges,
    );
  }
  return ranges;
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
    const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
    return finalizeDocumentAnalysis(previous, slices, excludedRanges);
  }

  if (delta.globalInvalidation || delta.dirtyWindows.length === 0) {
    const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
    return finalizeDocumentAnalysis(previous, slices, excludedRanges);
  }

  const changes = createPositionMapper(delta);
  const expandedForEquations = expandDirtyWindows(
    delta.dirtyWindows,
    previousState.equationSlice.equations,
    delta.mapOldToNew,
    false,
  );
  const expandedForExcluded = expandDirtyWindows(
    expandedForEquations,
    previousState.excludedRanges,
    delta.mapOldToNew,
    true,
  );
  const extractedDirtyWindows = extractDirtyFencedDivWindows(
    previousState.fencedDivSlice.fencedDivs,
    doc,
    tree,
    changes,
    expandedForExcluded,
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
  const equationSlice = mergeEquationSlice(
    previousState.equationSlice,
    delta,
    dirtyExtractions,
  );
  const excludedRanges = mergeExcludedRanges(
    previousState.excludedRanges,
    delta,
    dirtyExtractions,
  );

  // Compute narrative ref extractions using fresh tree-based excluded ranges.
  // Line-expands so the regex sees full-line context, then further expands
  // when the tree reports excluded nodes (InlineCode/InlineMath/Link) that
  // extend beyond the initial line range — e.g. a multi-line code span
  // created by a delimiter edit.
  const narrativeExtractions: NarrativeRefExtraction[] = dirtyExtractions.map(
    ({ window }) => {
      const { range, excludedRanges: freshExcluded } =
        computeNarrativeExtractionRange(doc, tree, window.fromNew, window.toNew);
      const narrativeRefs: ReferenceSemantics[] = [];
      collectNarrativeRefsInWindow(doc, freshExcluded, range, narrativeRefs);
      return { window: range, narrativeRefs };
    },
  );

  const referenceSlice = mergeReferenceSlice(
    previousState.referenceSlice,
    delta,
    dirtyExtractions,
    narrativeExtractions,
  );

  return finalizeDocumentAnalysis(previous, {
    headingSlice,
    footnoteSlice,
    fencedDivSlice,
    equationSlice,
    mathSlice,
    referenceSlice,
    includeSlice,
  }, excludedRanges);
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
