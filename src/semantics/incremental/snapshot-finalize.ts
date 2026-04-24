import type { Tree } from "@lezer/common";
import {
  classifyReferenceIndex,
} from "../../references/classifier";
import type { ReferenceIndexModel } from "../../references/model";
import type {
  DocumentAnalysis,
  FencedDivSemantics,
  ReferenceSemantics,
  TextSource,
} from "../document-model";
import {
  buildEquationSlice,
  type EquationSlice,
} from "./slices/equation-slice";
import {
  buildFootnoteSlice,
} from "./slices/footnote-slice";
import {
  buildHeadingSlice,
  type HeadingSlice,
} from "./slices/heading-slice";
import {
  buildMathSlice,
} from "./slices/math-slice";
import {
  buildReferenceSlice,
} from "./slices/reference-slice";
import {
  buildDocumentAnalysisBase,
  buildRevisionInfo,
  createFencedDivSlice,
  sameSlices,
  ZERO_REVISION_INFO,
  type DocumentAnalysisSlices,
  type IncrementalDocumentAnalysisState,
} from "./slice-registry";
import {
  extractStructuralWindow,
  type ExcludedRange,
} from "./window-extractor";

export interface DocumentAnalysisSnapshot extends DocumentAnalysis {
  readonly analysis: DocumentAnalysis;
  readonly incrementalState: IncrementalDocumentAnalysisState;
}

interface FullBuildResult {
  readonly slices: DocumentAnalysisSlices;
  readonly excludedRanges: readonly ExcludedRange[];
}

export function buildSlicesAndExcludedRanges(
  doc: TextSource,
  tree: Tree,
): FullBuildResult {
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

export function isDocumentAnalysisSnapshot(
  value: DocumentAnalysis | DocumentAnalysisSnapshot,
): value is DocumentAnalysisSnapshot {
  return (
    "analysis" in value
    && "incrementalState" in value
    && value.analysis !== undefined
  );
}

export function createDocumentAnalysisSnapshotValue(
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

export function snapshotFor(
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

function sameReferenceIndexInputs(
  previous: IncrementalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return (
    previous.headingSlice === next.headingSlice
    && previous.fencedDivSlice === next.fencedDivSlice
    && previous.equationSlice === next.equationSlice
    && previous.referenceSlice === next.referenceSlice
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

export function canMapReferenceIndexInputs(
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

export function finalizeDocumentAnalysis(
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
