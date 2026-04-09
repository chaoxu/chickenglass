import type { EditorState } from "@codemirror/state";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { bibDataField } from "../citations/citation-render";
import { classifyReference } from "../index/crossref-resolver";
import { blockCounterField } from "../state/block-counter";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Start position in the document (character offset). */
  readonly from: number;
  /** End position in the document (character offset). */
  readonly to: number;
}

function pushDuplicateIdDiagnostics(
  diagnostics: DiagnosticEntry[],
  state: EditorState,
): void {
  const analysis = state.field(documentAnalysisField);
  const counters = state.field(blockCounterField, false);
  const blockIds = new Set<string>();
  const equationIds = new Set<string>();
  const seenBlockIds = new Set<string>();
  const seenEquationIds = new Set<string>();
  const seenHeadingIds = new Set<string>();

  for (const block of counters?.blocks ?? []) {
    if (block.id) {
      blockIds.add(block.id);
    }
  }

  for (const equation of analysis.equations) {
    if (equation.id) {
      equationIds.add(equation.id);
    }
  }

  for (const block of counters?.blocks ?? []) {
    if (!block.id) continue;
    if (seenBlockIds.has(block.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate block ID "${block.id}"`,
        from: block.from,
        to: block.to,
      });
      continue;
    }
    seenBlockIds.add(block.id);
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

export function extractDiagnostics(state: EditorState): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const analysis = state.field(documentAnalysisField);
  pushDuplicateIdDiagnostics(diagnostics, state);

  // ── Warnings: unresolved references & citations ──────────────────────
  // Uses the same per-id classification helper as the inline renderer.
  const equationLabels = analysis.equationById;
  const bibState = state.field(bibDataField, false);
  const bibStore = bibState?.store;

  for (const ref of analysis.references) {
    for (const id of ref.ids) {
      const classification = classifyReference(state, id, {
        bibliography: bibStore,
        equationLabels,
        preferCitation: ref.bracketed,
      });
      if (classification.kind === "unresolved") {
        diagnostics.push({
          severity: "warning",
          message: `Unresolved reference "@${id}"`,
          from: ref.from,
          to: ref.to,
        });
      }
    }
  }

  // Sort: errors first, then by document position.
  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.from - b.from;
  });

  return diagnostics;
}
