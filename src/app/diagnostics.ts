import type { EditorState } from "@codemirror/state";
import { documentAnalysisField } from "../state/document-analysis";
import { bibDataField, type BibliographyStatus } from "../state/bib-data";
import { frontmatterField } from "../editor/frontmatter-state";
import { projectConfigStatusFacet, type ProjectConfigStatus } from "../project-config";
import type { DocumentAnalysis } from "../semantics/document";
import {
  buildReferenceConflictModel,
  type DuplicateReferenceTargetConflict,
  type ReferenceLookup,
} from "../semantics/reference-conflicts";
import type { DocumentReferenceTarget } from "../semantics/reference-catalog";

export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticSource =
  | "reference"
  | "frontmatter"
  | "project-config"
  | "bibliography";
export type DiagnosticCode =
  | "reference.duplicate-target"
  | "reference.unresolved"
  | "frontmatter.parse"
  | "project-config.read"
  | "project-config.parse"
  | "bibliography.read"
  | "bibliography.parse"
  | "bibliography.style";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly code: DiagnosticCode;
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
      && entry.source === after[index]?.source
      && entry.code === after[index]?.code
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
          source: "reference",
          code: "reference.duplicate-target",
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
        source: "reference",
        code: "reference.unresolved",
        message: `Unresolved reference "@${conflict.id}"`,
        from: conflict.reference.from,
        to: conflict.reference.to,
      });
    }
  }

  diagnostics.sort(compareDiagnostics);

  return diagnostics;
}

export function extractDiagnostics(state: EditorState): DiagnosticEntry[] {
  const analysis = state.field(documentAnalysisField);
  const bibData = state.field(bibDataField, false);
  const bibliographyUnavailable = bibData?.status.state === "error"
    && (
      bibData.status.kind === "read-bib"
      || bibData.status.kind === "parse-bib"
      || bibData.status.kind === "unexpected"
    );
  const diagnostics = extractDiagnosticsFromAnalysis(analysis, {
    bibliography: bibliographyUnavailable ? undefined : bibData?.store,
    localOnlyWithoutBibliography: bibliographyUnavailable,
  });
  const frontmatterStatus = state.field(frontmatterField, false)?.status;
  if (frontmatterStatus?.state === "error") {
    diagnostics.push({
      severity: "error",
      source: "frontmatter",
      code: "frontmatter.parse",
      message: `Invalid frontmatter: ${frontmatterStatus.message}`,
      from: frontmatterStatus.from,
      to: frontmatterStatus.to,
    });
  }
  const projectConfigDiagnostic = diagnosticFromProjectConfigStatus(
    state.facet(projectConfigStatusFacet),
  );
  if (projectConfigDiagnostic) diagnostics.push(projectConfigDiagnostic);
  const bibliographyDiagnostic = bibData
    ? diagnosticFromBibliographyStatus(bibData.status)
    : null;
  if (bibliographyDiagnostic) diagnostics.push(bibliographyDiagnostic);
  diagnostics.sort(compareDiagnostics);
  return diagnostics;
}

function compareDiagnostics(a: DiagnosticEntry, b: DiagnosticEntry): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  return a.from - b.from;
}

function diagnosticFromProjectConfigStatus(
  status: ProjectConfigStatus,
): DiagnosticEntry | null {
  if (status.state !== "error") return null;
  const code: DiagnosticCode = status.kind === "parse"
    ? "project-config.parse"
    : "project-config.read";
  return {
    severity: "error",
    source: "project-config",
    code,
    message: `Project config ${status.kind} failed: ${status.message}`,
    from: 0,
    to: 0,
  };
}

function diagnosticFromBibliographyStatus(
  status: BibliographyStatus,
): DiagnosticEntry | null {
  if (status.state !== "error" && status.state !== "warning") return null;
  const code: DiagnosticCode =
    status.kind === "style-csl" || status.kind === "read-csl"
      ? "bibliography.style"
      : status.kind === "parse-bib"
        ? "bibliography.parse"
        : "bibliography.read";
  const subject = status.kind === "read-csl" || status.kind === "style-csl"
    ? "CSL style"
    : "bibliography";
  const action = status.kind === "read-csl" || status.kind === "read-bib"
    ? "read"
    : status.kind === "style-csl"
      ? "parse"
      : status.kind === "parse-bib"
        ? "parse"
        : "load";
  return {
    severity: status.state === "error" ? "error" : "warning",
    source: "bibliography",
    code,
    message: `${subject} ${action} failed: ${status.message}`,
    from: 0,
    to: 0,
  };
}
