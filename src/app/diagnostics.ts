import type { EditorState } from "@codemirror/state";
import { documentAnalysisField } from "../state/document-analysis";
import { bibDataField } from "../state/bib-data";
import type { DocumentAnalysis } from "../semantics/document";
import { isLikelyLocalReferenceId } from "../lib/markdown/label-graph";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Start position in the document (character offset). */
  readonly from: number;
  /** End position in the document (character offset). */
  readonly to: number;
}

export function sameDiagnosticEntries(
  before: readonly DiagnosticEntry[],
  after: readonly DiagnosticEntry[],
): boolean {
  return before.length === after.length
    && before.every((entry, index) => (
      entry.severity === after[index]?.severity
      && entry.message === after[index]?.message
      && entry.from === after[index]?.from
      && entry.to === after[index]?.to
    ));
}

type ReferenceLookup = Pick<ReadonlyMap<string, unknown>, "has">;

interface AnalysisDiagnosticOptions {
  readonly bibliography?: ReferenceLookup;
  readonly localOnlyWithoutBibliography?: boolean;
}

function pushDuplicateIdDiagnosticsFromAnalysis(
  diagnostics: DiagnosticEntry[],
  analysis: DocumentAnalysis,
): void {
  const blockIds = new Set<string>();
  const equationIds = new Set<string>();
  const seenBlockIds = new Set<string>();
  const seenEquationIds = new Set<string>();
  const seenHeadingIds = new Set<string>();

  for (const fencedDiv of analysis.fencedDivs) {
    if (fencedDiv.id) {
      blockIds.add(fencedDiv.id);
    }
  }

  for (const equation of analysis.equations) {
    if (equation.id) {
      equationIds.add(equation.id);
    }
  }

  for (const fencedDiv of analysis.fencedDivs) {
    if (!fencedDiv.id) continue;
    if (seenBlockIds.has(fencedDiv.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate local target ID "${fencedDiv.id}"`,
        from: fencedDiv.attrFrom ?? fencedDiv.from,
        to: fencedDiv.attrTo ?? fencedDiv.to,
      });
      continue;
    }
    seenBlockIds.add(fencedDiv.id);
  }

  for (const equation of analysis.equations) {
    if (!equation.id) continue;
    if (blockIds.has(equation.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate local target ID "${equation.id}"`,
        from: equation.labelFrom,
        to: equation.labelTo,
      });
      continue;
    }
    if (seenEquationIds.has(equation.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate equation label "${equation.id}"`,
        from: equation.labelFrom,
        to: equation.labelTo,
      });
      continue;
    }
    seenEquationIds.add(equation.id);
  }

  for (const heading of analysis.headings) {
    if (!heading.id) continue;
    if (blockIds.has(heading.id) || equationIds.has(heading.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate local target ID "${heading.id}"`,
        from: heading.from,
        to: heading.to,
      });
      continue;
    }
    if (seenHeadingIds.has(heading.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate heading ID "${heading.id}"`,
        from: heading.from,
        to: heading.to,
      });
      continue;
    }
    seenHeadingIds.add(heading.id);
  }
}

export function extractDiagnosticsFromAnalysis(
  analysis: DocumentAnalysis,
  options: AnalysisDiagnosticOptions = {},
): DiagnosticEntry[] {
  const { bibliography, localOnlyWithoutBibliography = false } = options;
  const diagnostics: DiagnosticEntry[] = [];
  pushDuplicateIdDiagnosticsFromAnalysis(diagnostics, analysis);

  for (const ref of analysis.references) {
    for (const id of ref.ids) {
      if (!bibliography && localOnlyWithoutBibliography && !isLikelyLocalReferenceId(id)) {
        continue;
      }
      const localTarget = analysis.referenceIndex.get(id);
      if (localTarget?.type === "crossref" || localTarget?.type === "label") {
        continue;
      }
      if (bibliography?.has(id)) {
        continue;
      }
      diagnostics.push({
        severity: "warning",
        message: `Unresolved reference "@${id}"`,
        from: ref.from,
        to: ref.to,
      });
    }
  }

  // Sort: errors first, then by document position.
  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.from - b.from;
  });

  return diagnostics;
}

export function extractDiagnostics(state: EditorState): DiagnosticEntry[] {
  const analysis = state.field(documentAnalysisField);
  return extractDiagnosticsFromAnalysis(analysis, {
    bibliography: state.field(bibDataField, false)?.store,
  });
}
