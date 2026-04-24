import type { EditorState } from "@codemirror/state";
import { documentAnalysisField } from "../state/document-analysis";
import { bibDataField } from "../state/bib-data";
import type { DocumentAnalysis } from "../semantics/document";
import {
  buildReferenceConflictModel,
  type DuplicateReferenceTargetConflict,
  type ReferenceLookup,
} from "../semantics/reference-conflicts";
import type { DocumentReferenceTarget } from "../semantics/reference-catalog";

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

interface AnalysisDiagnosticOptions {
  readonly bibliography?: ReferenceLookup;
  readonly localOnlyWithoutBibliography?: boolean;
}

function duplicateTargetMessage(conflict: DuplicateReferenceTargetConflict): string {
  const kinds = new Set(conflict.targets.map((target) => target.kind));
  if (kinds.size !== 1) {
    return `Duplicate local target ID "${conflict.id}"`;
  }

  const kind = conflict.targets[0]?.kind;
  if (kind === "heading") {
    return `Duplicate heading ID "${conflict.id}"`;
  }
  if (kind === "equation") {
    return `Duplicate equation label "${conflict.id}"`;
  }
  return `Duplicate local target ID "${conflict.id}"`;
}

function duplicateDiagnosticRange(target: DocumentReferenceTarget): {
  readonly from: number;
  readonly to: number;
} {
  return { from: target.from, to: target.to };
}

export function extractDiagnosticsFromAnalysis(
  analysis: DocumentAnalysis,
  options: AnalysisDiagnosticOptions = {},
): DiagnosticEntry[] {
  const { bibliography, localOnlyWithoutBibliography = false } = options;
  const diagnostics: DiagnosticEntry[] = [];
  const conflictModel = buildReferenceConflictModel(analysis, {
    bibliography,
    localOnlyWithoutBibliography,
  });

  for (const conflict of conflictModel.conflicts) {
    if (conflict.kind === "duplicate-target") {
      const message = duplicateTargetMessage(conflict);
      for (const target of conflict.targets.slice(1)) {
        const { from, to } = duplicateDiagnosticRange(target);
        diagnostics.push({
          severity: "error",
          message,
          from,
          to,
        });
      }
      continue;
    }

    if (conflict.kind === "unresolved-reference") {
      diagnostics.push({
        severity: "warning",
        message: `Unresolved reference "@${conflict.id}"`,
        from: conflict.reference.from,
        to: conflict.reference.to,
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
