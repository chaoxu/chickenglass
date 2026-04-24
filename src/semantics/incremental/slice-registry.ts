import { compareRangesByFromThenTo } from "../../lib/range-order";
import type {
  DocumentAnalysis,
  FencedDivSemantics,
} from "../document-model";
import type { ReferenceIndexModel } from "../../references/model";
import type { EquationSlice } from "./slices/equation-slice";
import type { FootnoteSlice } from "./slices/footnote-slice";
import type { HeadingSlice } from "./slices/heading-slice";
import type { MathSlice } from "./slices/math-slice";
import type { ReferenceSlice } from "./slices/reference-slice";
import type { ExcludedRange } from "./window-extractor";

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

export type DocumentAnalysisBase = Omit<DocumentAnalysis, "referenceIndex">;

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

export interface IncrementalDocumentAnalysisState extends DocumentAnalysisSlices {
  readonly revisions: DocumentAnalysisRevisionInfo;
  readonly excludedRanges: readonly ExcludedRange[];
  readonly referenceIndex: ReferenceIndexModel;
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

export const SLICE_REGISTRY: readonly SliceRegistryEntry[] = [
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

export const ZERO_SLICE_REVISIONS = Object.freeze(
  Object.fromEntries(
    SLICE_REGISTRY.map(({ revisionKey }) => [revisionKey, 0]),
  ) as unknown as DocumentAnalysisSliceRevisions,
);

export const ZERO_REVISION_INFO: DocumentAnalysisRevisionInfo = Object.freeze({
  revision: 0,
  slices: ZERO_SLICE_REVISIONS,
});

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

export function createFencedDivSlice(
  fencedDivs: readonly FencedDivSemantics[],
): FencedDivSlice {
  return {
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
    structureRanges: collectFencedDivStructureRanges(fencedDivs),
  };
}

export function buildRevisionInfo(
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

export function sameSlices(
  previous: IncrementalDocumentAnalysisState,
  next: DocumentAnalysisSlices,
): boolean {
  return SLICE_REGISTRY.every(({ sliceKey }) =>
    previous[sliceKey] === next[sliceKey],
  );
}

export function buildDocumentAnalysisBase(
  slices: DocumentAnalysisSlices,
): DocumentAnalysisBase {
  const analysis = {} as DocumentAnalysisBase;
  for (const { sliceKey, project } of SLICE_REGISTRY) {
    Object.assign(analysis, project(slices[sliceKey]));
  }
  return analysis;
}
