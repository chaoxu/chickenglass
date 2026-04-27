import type { EditorState } from "@codemirror/state";
import katex from "katex";
import { documentAnalysisField } from "../state/document-analysis";
import { bibDataField } from "../state/bib-data";
import { frontmatterField } from "../editor/frontmatter-state";
import { projectConfigStatusFacet } from "../project-config";
import type { DocumentAnalysis } from "../semantics/document";
import { buildKatexOptions } from "../lib/katex-options";
import { findFencedDivOpenerTrailingContent } from "../parser/fenced-div";
import { mathMacrosField } from "../state/math-macros";
import type { DiagnosticEntry } from "./diagnostic-types";
import {
  buildReferenceConflictModel,
  type DuplicateReferenceTargetConflict,
  type ReferenceLookup,
} from "../semantics/reference-conflicts";
import type { DocumentReferenceTarget } from "../semantics/reference-catalog";
import {
  diagnosticFromBibliographyStatus,
  diagnosticFromFrontmatterStatus,
  diagnosticFromProjectConfigStatus,
} from "./diagnostic-status";

export {
  sameDiagnosticEntries,
  type DiagnosticCode,
  type DiagnosticEntry,
  type DiagnosticSeverity,
  type DiagnosticSource,
} from "./diagnostic-types";

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

function collisionDiagnosticRange(targets: readonly DocumentReferenceTarget[]): {
  readonly from: number;
  readonly to: number;
} {
  const target = targets[0];
  return target ? { from: target.from, to: target.to } : { from: 0, to: 0 };
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

    if (conflict.kind === "citation-local-target-collision") {
      const { from, to } = collisionDiagnosticRange(conflict.targets);
      diagnostics.push({
        severity: "warning",
        source: "reference",
        code: "reference.citation-local-collision",
        message: `Local target ID "${conflict.id}" shadows a bibliography entry`,
        from,
        to,
      });
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

function extractMathDiagnostics(
  analysis: DocumentAnalysis,
  macros: Record<string, string>,
): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  for (const region of analysis.mathRegions) {
    try {
      katex.renderToString(region.latex, {
        ...buildKatexOptions(region.isDisplay, macros),
        throwOnError: true,
        output: "html",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        severity: "error",
        source: "math",
        code: "math.render",
        message: `Invalid math: ${message}`,
        from: region.contentFrom,
        to: region.contentTo,
      });
    }
  }
  return diagnostics;
}

function extractFootnoteDiagnostics(analysis: DocumentAnalysis): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const referenced = new Set(analysis.footnotes.refs.map((ref) => ref.id));
  const defined = new Set(analysis.footnotes.defs.keys());

  for (const ref of analysis.footnotes.refs) {
    if (defined.has(ref.id)) continue;
    diagnostics.push({
      severity: "warning",
      source: "footnote",
      code: "footnote.missing-definition",
      message: `Missing footnote definition "[^${ref.id}]"`,
      from: ref.from,
      to: ref.to,
    });
  }

  for (const def of analysis.footnotes.defs.values()) {
    if (referenced.has(def.id)) continue;
    diagnostics.push({
      severity: "warning",
      source: "footnote",
      code: "footnote.orphan-definition",
      message: `Footnote definition "[^${def.id}]" is never referenced`,
      from: def.labelFrom,
      to: def.labelTo,
    });
  }

  return diagnostics;
}

function extractFencedDivOpenerDiagnostics(state: EditorState): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const doc = state.doc;
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const trailing = findFencedDivOpenerTrailingContent(line.text);
    if (!trailing) continue;
    diagnostics.push({
      severity: "warning",
      source: "fenced-div",
      code: "fenced-div.opener-trailing",
      message:
        "Fenced-div opener has unexpected content after the attribute block; merge classes, ID, and key=value pairs into a single {...} block.",
      from: line.from + trailing.from,
      to: line.from + trailing.to,
    });
  }
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
  diagnostics.push(...extractMathDiagnostics(
    analysis,
    state.field(mathMacrosField, false) ?? {},
  ));
  diagnostics.push(...extractFootnoteDiagnostics(analysis));
  diagnostics.push(...extractFencedDivOpenerDiagnostics(state));
  const frontmatterStatus = state.field(frontmatterField, false)?.status;
  const frontmatterDiagnostic = diagnosticFromFrontmatterStatus(frontmatterStatus);
  if (frontmatterDiagnostic) diagnostics.push(frontmatterDiagnostic);
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

export function compareDiagnostics(a: DiagnosticEntry, b: DiagnosticEntry): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  return a.from - b.from;
}
