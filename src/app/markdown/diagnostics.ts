import {
  buildDocumentLabelGraph,
  isLikelyLocalReferenceId,
} from "./labels";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly from: number;
  readonly to: number;
}

const INCLUDE_BLOCK_RE = /^:::\s*\{\.include\}\s*\n([\s\S]*?)\n:::\s*$/gm;

export function extractDiagnosticsFromMarkdown(doc: string): DiagnosticEntry[] {
  const graph = buildDocumentLabelGraph(doc);
  const diagnostics: DiagnosticEntry[] = [];

  for (const [id, definitions] of graph.duplicatesById) {
    for (const definition of definitions) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate local target ID "${id}"`,
        from: definition.from,
        to: definition.to,
      });
    }
  }

  for (const reference of graph.references) {
    if (!isLikelyLocalReferenceId(reference.id)) {
      continue;
    }
    if (graph.definitionsById.has(reference.id)) {
      continue;
    }
    diagnostics.push({
      severity: "warning",
      message: `Unresolved reference "@${reference.id}"`,
      from: reference.from,
      to: reference.to,
    });
  }

  for (const match of doc.matchAll(INCLUDE_BLOCK_RE)) {
    const includePath = match[1]?.trim();
    if (!includePath) {
      continue;
    }
    const from = match.index ?? 0;
    diagnostics.push({
      severity: "warning",
      message: `Unresolved include "${includePath}"`,
      from,
      to: from + match[0].length,
    });
  }

  diagnostics.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "error" ? -1 : 1;
    }
    return left.from - right.from;
  });

  return diagnostics;
}
