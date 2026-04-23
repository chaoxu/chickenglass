import type { Tree } from "@lezer/common";
import { buildDocumentIR } from "../../ir/document-ir-builder";
import type { DocumentIR } from "../../ir/types";
import {
  classifyReferenceIndex,
  mapReferenceIndex,
} from "../../references/classifier";
import type { ReferenceIndexModel } from "../../references/model";
import type {
  DocumentAnalysis,
  FencedDivSemantics,
  TextSource,
} from "../document";
import {
  buildEquationSlice,
  mergeEquationSlice,
  type EquationSlice,
} from "./slices/equation-slice";
import {
  type ExtractedDirtyStructuralWindow,
  extractDirtyFencedDivWindows,
  mapFencedDivSemantics,
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
import {
  buildMathSlice,
  computeMathOverhangRanges,
  expandDirtyMathExtractions,
  mapMathRegionUpdate,
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
  lowerBoundByTo,
  replaceOverlappingRanges,
  type PositionMapper,
} from "./merge-utils";
import { compareRangesByFromThenTo } from "../../lib/range-order";
import type { DirtyWindow, SemanticDelta } from "./types";
import type { ReferenceSemantics } from "../document";
import {
  collectNarrativeRefsInWindow,
  computeNarrativeExtractionRange,
  expandRangeToParagraphBoundaries,
  extractInlineStructuralWindow,
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
}

export type DocumentAnalysisSliceName = keyof DocumentAnalysisSliceRevisions;

export interface DocumentAnalysisRevisionInfo {
  readonly revision: number;
  readonly slices: DocumentAnalysisSliceRevisions;
}

export interface DocumentArtifacts {
  readonly analysis: DocumentAnalysis;
  readonly analysisSnapshot: DocumentAnalysisSnapshot;
  readonly ir: DocumentIR;
}

type DocumentAnalysisBase = Omit<DocumentAnalysis, "referenceIndex">;

export interface FencedDivSlice {
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly fencedDivByFrom: ReadonlyMap<number, FencedDivSemantics>;
  readonly structureRanges: readonly { readonly from: number; readonly to: number }[];
}

export interface DocumentAnalysisSlices {
  readonly headingSlice: HeadingSlice;
  readonly footnoteSlice: FootnoteSlice;
  readonly fencedDivSlice: FencedDivSlice;
  readonly equationSlice: EquationSlice;
  readonly mathSlice: MathSlice;
  readonly referenceSlice: ReferenceSlice;
}

interface SliceRegistryEntry {
  readonly revisionKey: DocumentAnalysisSliceName;
  readonly sliceKey: keyof DocumentAnalysisSlices;
  readonly project: (
    slice: DocumentAnalysisSlices[keyof DocumentAnalysisSlices],
  ) => Partial<DocumentAnalysisBase>;
}

function sliceEntry<SK extends keyof DocumentAnalysisSlices>(
  revisionKey: DocumentAnalysisSliceName,
  sliceKey: SK,
  project: (slice: DocumentAnalysisSlices[SK]) => Partial<DocumentAnalysisBase>,
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
];

export interface IncrementalDocumentAnalysisState extends DocumentAnalysisSlices {
  readonly revisions: DocumentAnalysisRevisionInfo;
  readonly excludedRanges: readonly ExcludedRange[];
  readonly referenceIndex: ReferenceIndexModel;
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

export interface DocumentAnalysisSnapshot extends DocumentAnalysis {
  readonly analysis: DocumentAnalysis;
  readonly incrementalState: IncrementalDocumentAnalysisState;
}

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
    structureRanges: collectFencedDivStructureRanges(fencedDivs),
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
    },
    excludedRanges: structural.excludedRanges,
  };
}

function isDocumentAnalysisSnapshot(
  value: DocumentAnalysis | DocumentAnalysisSnapshot,
): value is DocumentAnalysisSnapshot {
  return (
    "analysis" in value
    && "incrementalState" in value
    && value.analysis !== undefined
  );
}

function createDocumentAnalysisSnapshotValue(
  analysis: DocumentAnalysis,
  incrementalState: IncrementalDocumentAnalysisState,
): DocumentAnalysisSnapshot {
  const snapshot = { ...analysis } as DocumentAnalysisSnapshot;
  Object.defineProperties(snapshot, {
    analysis: {
      value: analysis,
    },
    incrementalState: {
      value: incrementalState,
    },
  });
  return snapshot;
}

function snapshotFor(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
): DocumentAnalysisSnapshot | undefined {
  return isDocumentAnalysisSnapshot(analysis) ? analysis : undefined;
}

export function createDocumentAnalysisSnapshotFromAnalysis(
  doc: TextSource,
  tree: Tree,
  analysis: DocumentAnalysis,
): DocumentAnalysisSnapshot {
  const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
  const referenceIndex = analysis.referenceIndex;
  const revisions = ZERO_REVISION_INFO;
  return createDocumentAnalysisSnapshotValue(analysis, {
    ...slices,
    revisions,
    excludedRanges,
    referenceIndex,
  });
}

function buildRevisionInfo(
  previous: IncrementalDocumentAnalysisState | undefined,
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
  previous: IncrementalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return SLICE_REGISTRY.every(({ sliceKey }) =>
    previous[sliceKey] === next[sliceKey],
  );
}

function sameReferenceIndexInputs(
  previous: IncrementalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return (
    previous.headingSlice === next.headingSlice &&
    previous.fencedDivSlice === next.fencedDivSlice &&
    previous.equationSlice === next.equationSlice &&
    previous.referenceSlice === next.referenceSlice
  );
}

function sameReferenceIndexHeadingMetadata(
  left: HeadingSlice["headings"],
  right: HeadingSlice["headings"],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.level !== after.level
      || before.text !== after.text
      || before.id !== after.id
      || before.number !== after.number
      || before.unnumbered !== after.unnumbered
    ) {
      return false;
    }
  }
  return true;
}

function sameReferenceIndexFencedDivMetadata(
  left: readonly FencedDivSemantics[],
  right: readonly FencedDivSemantics[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.primaryClass !== after.primaryClass
      || before.id !== after.id
      || before.title !== after.title
      || (before.attrFrom !== undefined) !== (after.attrFrom !== undefined)
      || (before.attrTo !== undefined) !== (after.attrTo !== undefined)
    ) {
      return false;
    }
  }
  return true;
}

function sameReferenceIndexEquationMetadata(
  left: EquationSlice["equations"],
  right: EquationSlice["equations"],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.id !== after.id
      || before.number !== after.number
      || before.latex !== after.latex
    ) {
      return false;
    }
  }
  return true;
}

function sameReferenceIndexReferenceMetadata(
  left: readonly ReferenceSemantics[],
  right: readonly ReferenceSemantics[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.bracketed !== after.bracketed
      || before.ids !== after.ids
      || before.locators !== after.locators
    ) {
      return false;
    }
  }
  return true;
}

function canMapReferenceIndexInputs(
  previous: IncrementalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return (
    sameReferenceIndexHeadingMetadata(previous.headingSlice.headings, next.headingSlice.headings)
    && sameReferenceIndexFencedDivMetadata(
      previous.fencedDivSlice.fencedDivs,
      next.fencedDivSlice.fencedDivs,
    )
    && sameReferenceIndexEquationMetadata(
      previous.equationSlice.equations,
      next.equationSlice.equations,
    )
    && sameReferenceIndexReferenceMetadata(
      previous.referenceSlice.references,
      next.referenceSlice.references,
    )
  );
}

function buildDocumentAnalysisBase(
  slices: DocumentAnalysisSlices,
): DocumentAnalysisBase {
  const analysis = {} as DocumentAnalysisBase;
  for (const { sliceKey, project } of SLICE_REGISTRY) {
    Object.assign(analysis, project(slices[sliceKey]));
  }
  return analysis;
}

function finalizeDocumentAnalysis(
  previous: DocumentAnalysisSnapshot | undefined,
  slices: DocumentAnalysisSlices,
  excludedRanges: readonly ExcludedRange[],
  doc: TextSource,
  referenceIndexOverride?: ReferenceIndexModel,
): DocumentAnalysisSnapshot {
  const previousState = previous?.incrementalState;
  if (
    previous && previousState
    && sameSlices(previousState, slices)
    && previousState.excludedRanges === excludedRanges
  ) {
    return previous;
  }

  const revisions = buildRevisionInfo(previousState, slices);
  const analysisBase = buildDocumentAnalysisBase(slices);
  const referenceIndex = referenceIndexOverride
    ?? (
    previousState && sameReferenceIndexInputs(previousState, slices)
      ? previousState.referenceIndex
      : classifyReferenceIndex(doc, analysisBase)
    );
  const analysis: DocumentAnalysis = {
    ...analysisBase,
    referenceIndex,
  };

  return createDocumentAnalysisSnapshotValue(analysis, {
    ...slices,
    revisions,
    excludedRanges,
    referenceIndex,
  });
}

export function createDocumentAnalysisSnapshot(
  doc: TextSource,
  tree: Tree,
): DocumentAnalysisSnapshot {
  const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
  return finalizeDocumentAnalysis(undefined, slices, excludedRanges, doc);
}

export function createDocumentAnalysis(
  doc: TextSource,
  tree: Tree,
): DocumentAnalysis {
  return createDocumentAnalysisSnapshot(doc, tree).analysis;
}

export function buildDocumentArtifacts(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  const snapshot = snapshotFor(analysis)
    ?? createDocumentAnalysisSnapshotFromAnalysis(doc, tree, analysis);
  return {
    analysis: snapshot.analysis,
    analysisSnapshot: snapshot,
    ir: buildDocumentIR({
      analysis: snapshot.analysis,
      doc,
      docText: doc.slice(0, doc.length),
      tree,
    }),
  };
}

export function createDocumentArtifacts(
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  return buildDocumentArtifacts(createDocumentAnalysisSnapshot(doc, tree), doc, tree);
}

function mapExcludedRanges(
  values: readonly ExcludedRange[],
  changes: PositionMapper,
): readonly ExcludedRange[] {
  let changed = false;
  const mapped = values.map((value) => {
    const from = changes.mapPos(value.from, 1);
    const to = Math.max(from, changes.mapPos(value.to, -1));
    const next = from === value.from && to === value.to
      ? value
      : { from, to };
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

    // Binary search: jump to the first range whose `to` can satisfy the
    // overlap condition with the window's left edge.
    //   touchingInclusive: fromOld <= range.to  →  range.to >= fromOld
    //   non-inclusive:     fromOld <  range.to  →  range.to >= fromOld + 1
    const minTo = touchingInclusive ? fromOld : fromOld + 1;
    let i = lowerBoundByTo(previousRanges, minTo);

    // Scan forward: every candidate from `i` onward has range.to >= minTo,
    // and fromOld can only decrease during expansion, so the `to` half of
    // the overlap condition stays satisfied. Stop once source-ordered ranges
    // are past the growing toOld.
    while (i < previousRanges.length) {
      const range = previousRanges[i];
      if (range.from > toOld) break;
      if (range.from <= toOld) {
        const mappedFrom = mapOldToNew(range.from, -1);
        const mappedTo = Math.max(mappedFrom, mapOldToNew(range.to, 1));
        fromOld = Math.min(fromOld, range.from);
        toOld = Math.max(toOld, range.to);
        fromNew = Math.min(fromNew, mappedFrom);
        toNew = Math.max(toNew, mappedTo);
        expanded = true;
      }
      i++;
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

function collectFencedDivStructureRanges(
  fencedDivs: readonly FencedDivSemantics[],
): readonly { readonly from: number; readonly to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const div of fencedDivs) {
    // openFenceTo already covers the opener attributes and title; keeping only
    // opener/closer ranges preserves non-overlapping source order.
    ranges.push({ from: div.openFenceFrom, to: div.openFenceTo });
    if (div.closeFenceFrom >= 0 && div.closeFenceFrom < div.closeFenceTo) {
      ranges.push({ from: div.closeFenceFrom, to: div.closeFenceTo });
    }
  }
  return ranges.sort(compareRangesByFromThenTo);
}

function windowTouchesRange(
  range: { readonly from: number; readonly to: number },
  window: Pick<DirtyWindow, "fromOld" | "toOld">,
): boolean {
  if (window.fromOld === window.toOld) {
    return range.from <= window.fromOld && window.fromOld <= range.to;
  }
  return range.from < window.toOld && window.fromOld < range.to;
}

function windowTouchesSortedRanges(
  window: Pick<DirtyWindow, "fromOld" | "toOld">,
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  if (ranges.length === 0) {
    return false;
  }

  const index = lowerBoundByTo(
    ranges,
    window.fromOld === window.toOld ? window.fromOld : window.fromOld + 1,
  );
  for (let current = index; current < ranges.length; current += 1) {
    const range = ranges[current];
    if (range.from > window.toOld) {
      return false;
    }
    if (windowTouchesRange(range, window)) {
      return true;
    }
  }
  return false;
}

function windowsTouchSortedRanges(
  windows: readonly Pick<DirtyWindow, "fromOld" | "toOld">[],
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  return windows.some((window) => windowTouchesSortedRanges(window, ranges));
}

function classifyStructuralExtraction(
  previousState: IncrementalDocumentAnalysisState,
  delta: SemanticDelta,
): "skip" | "paragraph" | "full" {
  if (!delta.plainInlineTextOnlyChange) {
    return "full";
  }

  const dirtyWindows = delta.dirtyWindows;

  const touchesStructuralOwners = (
    windowsTouchSortedRanges(dirtyWindows, previousState.headingSlice.headings)
    || windowsTouchSortedRanges(dirtyWindows, previousState.footnoteSlice.refs)
    || windowsTouchSortedRanges(dirtyWindows, previousState.footnoteSlice.definitions)
    || windowsTouchSortedRanges(dirtyWindows, previousState.fencedDivSlice.structureRanges)
    || windowsTouchSortedRanges(dirtyWindows, previousState.equationSlice.equations)
  );
  if (touchesStructuralOwners) {
    return "full";
  }

  const touchesInlineOwners = (
    windowsTouchSortedRanges(dirtyWindows, previousState.mathSlice.mathRegions)
    || windowsTouchSortedRanges(dirtyWindows, previousState.referenceSlice.references)
    || windowsTouchSortedRanges(dirtyWindows, previousState.excludedRanges)
  );
  return touchesInlineOwners ? "paragraph" : "skip";
}

function extractDirtyParagraphWindows(
  doc: TextSource,
  tree: Tree,
  dirtyWindows: readonly DirtyWindow[],
): readonly ExtractedDirtyStructuralWindow[] {
  return dirtyWindows.map((window) => {
    const range = expandRangeToParagraphBoundaries(doc, {
      from: window.fromNew,
      to: window.toNew,
    });
    return {
      window,
      range,
      structural: extractInlineStructuralWindow(doc, tree, range),
    };
  });
}

function mapFencedDivsOnly(
  previous: readonly FencedDivSemantics[],
  changes: PositionMapper,
): readonly FencedDivSemantics[] {
  let changed = false;
  const mapped = previous.map((div) => {
    const next = mapFencedDivSemantics(div, changes);
    if (next !== div) {
      changed = true;
    }
    return next;
  });
  return changed ? mapped : previous;
}

export function updateDocumentAnalysisSnapshot(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentAnalysisSnapshot {
  const previousState = previous.incrementalState;

  if (!delta.docChanged) {
    if (!delta.syntaxTreeChanged && !delta.globalInvalidation) {
      return previous;
    }
    const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
    return finalizeDocumentAnalysis(previous, slices, excludedRanges, doc);
  }

  if (delta.globalInvalidation || delta.dirtyWindows.length === 0) {
    const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
    return finalizeDocumentAnalysis(previous, slices, excludedRanges, doc);
  }

  const changes = createPositionMapper(delta);
  const structuralExtractionMode = classifyStructuralExtraction(previousState, delta);
  const skipStructuralExtraction = structuralExtractionMode === "skip";
  const useParagraphStructuralExtraction = structuralExtractionMode === "paragraph";
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
  const extractedDirtyWindows = skipStructuralExtraction
    ? []
    : useParagraphStructuralExtraction
      ? extractDirtyParagraphWindows(doc, tree, expandedForExcluded)
      : extractDirtyFencedDivWindows(
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
    useParagraphStructuralExtraction ? [] : dirtyExtractions,
  );
  const footnoteSlice = mergeFootnoteSlice(
    previousState.footnoteSlice,
    delta,
    useParagraphStructuralExtraction ? [] : dirtyExtractions,
  );
  const mergedFencedDivs = useParagraphStructuralExtraction
    ? reuseEquivalentArray(
        previousState.fencedDivSlice.fencedDivs,
        mapFencedDivsOnly(previousState.fencedDivSlice.fencedDivs, changes),
      )
    : reuseEquivalentArray(
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
  const mappedMathRegions = mapMathRegionUpdate(previousState.mathSlice, delta);
  const mathDirtyExtractions = expandDirtyMathExtractions(
    previousState.mathSlice,
    delta,
    dirtyExtractions,
    doc,
    tree,
    mappedMathRegions,
  );
  const mathSlice = mergeMathSlice(
    previousState.mathSlice,
    delta,
    mathDirtyExtractions,
    doc,
    tree,
    mappedMathRegions,
  );
  // When a large mapped math region (e.g. BigUnclosed $$…EOF) overlaps a dirty
  // window and is removed, its tail may contain equations that are not covered
  // by any dirty window.  mergeMathSlice handles math-region re-extraction
  // internally; here we extend the same overhang coverage to the equation slice.
  const mathOverhangRanges = computeMathOverhangRanges(
    previousState.mathSlice,
    delta,
    dirtyExtractions.map((e) => e.window),
    mappedMathRegions,
  );
  const equationDirtyExtractions = mathOverhangRanges.length === 0
    ? (useParagraphStructuralExtraction ? [] : dirtyExtractions)
    : [
      ...(useParagraphStructuralExtraction ? [] : dirtyExtractions),
      ...mathOverhangRanges.map(range => ({
        window: { fromNew: range.from, toNew: range.to },
        structural: extractStructuralWindow(doc, tree, range, {
          includeNarrativeRefs: false,
        }),
      })),
    ];
  const equationSlice = mergeEquationSlice(
    previousState.equationSlice,
    delta,
    equationDirtyExtractions,
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
    ({ window, structural }) => {
      if (useParagraphStructuralExtraction) {
        const narrativeRefs: ReferenceSemantics[] = [];
        const range = { from: window.fromNew, to: window.toNew };
        collectNarrativeRefsInWindow(
          doc,
          structural.excludedRanges,
          range,
          narrativeRefs,
        );
        return { window: range, narrativeRefs };
      }

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

  const referenceIndex = canMapReferenceIndexInputs(previousState, {
    headingSlice,
    footnoteSlice,
    fencedDivSlice,
    equationSlice,
    mathSlice,
    referenceSlice,
  })
    ? mapReferenceIndex(previousState.referenceIndex, changes)
    : undefined;

  return finalizeDocumentAnalysis(previous, {
    headingSlice,
    footnoteSlice,
    fencedDivSlice,
    equationSlice,
    mathSlice,
    referenceSlice,
  }, excludedRanges, doc, referenceIndex);
}

export function updateDocumentAnalysis(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentAnalysisSnapshot;
export function updateDocumentAnalysis(
  previous: DocumentAnalysis,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentAnalysis;
export function updateDocumentAnalysis(
  previous: DocumentAnalysis | DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentAnalysis | DocumentAnalysisSnapshot {
  const snapshot = snapshotFor(previous);
  if (!snapshot) {
    return createDocumentAnalysis(doc, tree);
  }
  return updateDocumentAnalysisSnapshot(snapshot, doc, tree, delta);
}

export function updateDocumentArtifacts(
  previous: DocumentArtifacts,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentArtifacts {
  return buildDocumentArtifacts(
    updateDocumentAnalysisSnapshot(previous.analysisSnapshot, doc, tree, delta),
    doc,
    tree,
  );
}

export function getDocumentAnalysisRevisionInfo(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
): DocumentAnalysisRevisionInfo {
  return snapshotFor(analysis)?.incrementalState.revisions ?? ZERO_REVISION_INFO;
}

export function getDocumentAnalysisRevision(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).revision;
}

export function getDocumentAnalysisSliceRevision(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
  slice: DocumentAnalysisSliceName,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).slices[slice];
}
