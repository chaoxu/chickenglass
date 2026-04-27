import {
  extractDiagnosticsFromAnalysis,
  sameDiagnosticEntries,
  type DiagnosticEntry,
} from "../diagnostics";
import { headingEntriesFromAnalysis, type HeadingEntry } from "../heading-ancestry";
import { measureSync } from "../perf";
import type { DocumentAnalysisSnapshot } from "../../semantics/incremental/engine";
import { getDocumentAnalysisSliceRevision } from "../../semantics/incremental/engine";

export interface SidebarDiagnosticsSliceRevisions {
  readonly equations: number;
  readonly fencedDivs: number;
  readonly headings: number;
  readonly mathRegions: number;
  readonly references: number;
}

export interface SidebarSemanticState {
  readonly diagnostics: DiagnosticEntry[];
  readonly diagnosticsEnabled: boolean;
  readonly diagnosticsRevisions?: SidebarDiagnosticsSliceRevisions;
  readonly headings: HeadingEntry[];
  readonly headingsRevision: number;
}

export interface DeriveSidebarSemanticStateOptions {
  readonly includeDiagnostics: boolean;
  readonly localOnlyWithoutBibliography?: boolean;
  readonly metricPrefix?: string;
  readonly reuseByRevision?: boolean;
}

function measureProjection<T>(
  metricPrefix: string | undefined,
  name: string,
  detail: string,
  task: () => T,
): T {
  if (!metricPrefix) {
    return task();
  }
  return measureSync(`${metricPrefix}.${name}`, task, {
    category: metricPrefix,
    detail,
  });
}

function diagnosticSliceRevisions(
  analysis: DocumentAnalysisSnapshot,
): SidebarDiagnosticsSliceRevisions {
  return {
    equations: getDocumentAnalysisSliceRevision(analysis, "equations"),
    fencedDivs: getDocumentAnalysisSliceRevision(analysis, "fencedDivs"),
    headings: getDocumentAnalysisSliceRevision(analysis, "headings"),
    mathRegions: getDocumentAnalysisSliceRevision(analysis, "mathRegions"),
    references: getDocumentAnalysisSliceRevision(analysis, "references"),
  };
}

function sameDiagnosticSliceRevisions(
  before: SidebarDiagnosticsSliceRevisions | undefined,
  after: SidebarDiagnosticsSliceRevisions | undefined,
): boolean {
  return before?.equations === after?.equations
    && before?.fencedDivs === after?.fencedDivs
    && before?.headings === after?.headings
    && before?.mathRegions === after?.mathRegions
    && before?.references === after?.references;
}

function sameHeadingEntries(
  before: readonly HeadingEntry[],
  after: readonly HeadingEntry[],
): boolean {
  return before.length === after.length
    && before.every((entry, index) => (
      entry.level === after[index]?.level
      && entry.number === after[index]?.number
      && entry.pos === after[index]?.pos
      && entry.text === after[index]?.text
    ));
}

export function deriveSidebarSemanticState(
  analysis: DocumentAnalysisSnapshot,
  options: DeriveSidebarSemanticStateOptions,
  previous?: SidebarSemanticState,
): SidebarSemanticState {
  const reuseByRevision = options.reuseByRevision ?? true;
  const headingsRevision = getDocumentAnalysisSliceRevision(analysis, "headings");
  const reusableHeadings = reuseByRevision
    && previous
    && previous.headingsRevision === headingsRevision
    ? previous.headings
    : null;
  const headings = reusableHeadings
    ? reusableHeadings
    : measureProjection(
        options.metricPrefix,
        "deriveHeadings",
        `${analysis.headings.length} headings`,
        () => headingEntriesFromAnalysis(analysis),
      );
  const stableHeadings = previous
    && sameHeadingEntries(previous.headings, headings)
    ? previous.headings
    : headings;

  let diagnostics: DiagnosticEntry[] = [];
  const nextDiagnosticsRevisions = options.includeDiagnostics
    ? diagnosticSliceRevisions(analysis)
    : undefined;
  if (options.includeDiagnostics) {
    const reusableDiagnostics = reuseByRevision
      && previous
      && previous.diagnosticsEnabled
      && sameDiagnosticSliceRevisions(previous.diagnosticsRevisions, nextDiagnosticsRevisions)
      ? previous.diagnostics
      : null;
    diagnostics = reusableDiagnostics
      ? reusableDiagnostics
      : measureProjection(
          options.metricPrefix,
          "deriveDiagnostics",
          `${analysis.references.length} refs`,
          () => extractDiagnosticsFromAnalysis(analysis, {
            localOnlyWithoutBibliography: options.localOnlyWithoutBibliography ?? false,
          }),
        );
    if (
      previous?.diagnosticsEnabled
      && sameDiagnosticEntries(previous.diagnostics, diagnostics)
    ) {
      diagnostics = previous.diagnostics;
    }
  }

  return {
    diagnostics,
    diagnosticsEnabled: options.includeDiagnostics,
    diagnosticsRevisions: nextDiagnosticsRevisions,
    headings: stableHeadings,
    headingsRevision,
  };
}
