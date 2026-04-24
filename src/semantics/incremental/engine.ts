import type { Tree } from "@lezer/common";
import { buildDocumentIR } from "../../ir/document-ir-builder";
import type { DocumentIR } from "../../ir/types";
import { mapReferenceIndex } from "../../references/classifier";
import type {
  DocumentAnalysis,
  TextSource,
} from "../document-model";
import {
  computeNarrativeExtractions,
  mapFencedDivsOnly,
  mergeExcludedRanges,
  planDirtyWindows,
} from "./dirty-window-planning";
import {
  mergeEquationSlice,
} from "./slices/equation-slice";
import {
  mergeFencedDivSlice,
} from "./slices/fenced-div-slice";
import {
  mergeFootnoteSlice,
} from "./slices/footnote-slice";
import {
  mergeHeadingSlice,
} from "./slices/heading-slice";
import {
  computeMathOverhangRanges,
  expandDirtyMathExtractions,
  mapMathRegionUpdate,
  mergeMathSlice,
} from "./slices/math-slice";
import {
  mergeReferenceSlice,
} from "./slices/reference-slice";
import {
  createFencedDivSlice,
  ZERO_REVISION_INFO,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSlices,
} from "./slice-registry";
import {
  buildSlicesAndExcludedRanges,
  canMapReferenceIndexInputs,
  createDocumentAnalysisSnapshotFromAnalysis as createSnapshotFromAnalysis,
  finalizeDocumentAnalysis,
  snapshotFor,
  type DocumentAnalysisSnapshot,
} from "./snapshot-finalize";
import type { SemanticDelta } from "./types";
import { extractStructuralWindow } from "./window-extractor";

export type {
  DocumentAnalysisRevisionInfo,
  DocumentAnalysisSliceName,
  DocumentAnalysisSliceRevisions,
  DocumentAnalysisSlices,
  FencedDivSlice,
  IncrementalDocumentAnalysisState,
} from "./slice-registry";
export type { DocumentAnalysisSnapshot } from "./snapshot-finalize";
export {
  createSnapshotFromAnalysis as createDocumentAnalysisSnapshotFromAnalysis,
};

export interface DocumentArtifacts {
  readonly analysis: DocumentAnalysis;
  readonly analysisSnapshot: DocumentAnalysisSnapshot;
  readonly ir: DocumentIR;
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
    ?? createSnapshotFromAnalysis(doc, tree, analysis);
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

  const {
    changes,
    useParagraphStructuralExtraction,
    extractedDirtyWindows,
    dirtyExtractions,
  } = planDirtyWindows(previousState, doc, tree, delta);

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
  const mathOverhangRanges = computeMathOverhangRanges(
    previousState.mathSlice,
    delta,
    dirtyExtractions.map((e) => e.window),
    mappedMathRegions,
  );
  const baseEquationDirtyExtractions = useParagraphStructuralExtraction
    ? []
    : dirtyExtractions;
  const equationDirtyExtractions = mathOverhangRanges.length === 0
    ? baseEquationDirtyExtractions
    : [
      ...baseEquationDirtyExtractions,
      ...mathOverhangRanges.map((range) => ({
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

  const narrativeExtractions = computeNarrativeExtractions(
    doc,
    tree,
    dirtyExtractions,
    useParagraphStructuralExtraction,
  );

  const referenceSlice = mergeReferenceSlice(
    previousState.referenceSlice,
    delta,
    dirtyExtractions,
    narrativeExtractions,
  );

  const nextSlices: DocumentAnalysisSlices = {
    headingSlice,
    footnoteSlice,
    fencedDivSlice,
    equationSlice,
    mathSlice,
    referenceSlice,
  };
  const referenceIndex = canMapReferenceIndexInputs(previousState, nextSlices)
    ? mapReferenceIndex(previousState.referenceIndex, changes)
    : undefined;

  return finalizeDocumentAnalysis(
    previous,
    nextSlices,
    excludedRanges,
    doc,
    referenceIndex,
  );
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
