import type { EditorState } from "@codemirror/state";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { blockCounterField } from "../plugins/block-counter";
import { bibDataField } from "../citations/citation-render";
import {
  resolveCrossref,
  collectEquationLabels,
} from "../index/crossref-resolver";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Start position in the document (character offset). */
  readonly from: number;
  /** End position in the document (character offset). */
  readonly to: number;
}

export function extractDiagnostics(state: EditorState): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const analysis = state.field(documentAnalysisField);

  // ── Errors: duplicate block IDs ──────────────────────────────────────
  const counters = state.field(blockCounterField, false);
  if (counters) {
    const seenBlockIds = new Set<string>();
    for (const block of counters.blocks) {
      if (!block.id) continue;
      if (seenBlockIds.has(block.id)) {
        diagnostics.push({
          severity: "error",
          message: `Duplicate block ID "${block.id}"`,
          from: block.from,
          to: block.to,
        });
      } else {
        seenBlockIds.add(block.id);
      }
    }
  }

  // ── Errors: duplicate equation labels ────────────────────────────────
  const seenEqIds = new Set<string>();
  for (const eq of analysis.equations) {
    if (!eq.id) continue;
    if (seenEqIds.has(eq.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate equation label "${eq.id}"`,
        from: eq.labelFrom,
        to: eq.labelTo,
      });
    } else {
      seenEqIds.add(eq.id);
    }
  }

  // ── Errors: duplicate heading IDs ────────────────────────────────────
  const seenHeadingIds = new Set<string>();
  for (const h of analysis.headings) {
    if (!h.id) continue;
    if (seenHeadingIds.has(h.id)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate heading ID "${h.id}"`,
        from: h.from,
        to: h.to,
      });
    } else {
      seenHeadingIds.add(h.id);
    }
  }

  // ── Warnings: unresolved references & citations ──────────────────────
  const equationLabels = collectEquationLabels(state);
  let bibStore: ReadonlyMap<string, unknown> | undefined;
  try {
    bibStore = state.field(bibDataField).store;
  } catch {
    // Bibliography field not present in this editor configuration.
  }

  for (const ref of analysis.references) {
    for (const id of ref.ids) {
      const resolved = resolveCrossref(state, id, equationLabels);
      if (resolved.kind === "citation") {
        if (bibStore && !bibStore.has(id)) {
          diagnostics.push({
            severity: "warning",
            message: `Unresolved citation "@${id}"`,
            from: ref.from,
            to: ref.to,
          });
        }
      } else if (resolved.kind === "unresolved") {
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
