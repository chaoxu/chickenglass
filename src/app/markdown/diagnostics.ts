import {
  buildDocumentLabelGraph,
  isLikelyLocalReferenceId,
} from "./labels";
import { extractMarkdownIncludeReferences } from "./includes";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly from: number;
  readonly to: number;
}

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

  for (const includeReference of extractMarkdownIncludeReferences(doc)) {
    diagnostics.push({
      severity: "warning",
      message: `Unresolved include "${includeReference.path}"`,
      from: includeReference.from,
      to: includeReference.to,
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
