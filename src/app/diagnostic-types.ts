export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticSource =
  | "reference"
  | "frontmatter"
  | "project-config"
  | "bibliography";
export type DiagnosticCode =
  | "reference.duplicate-target"
  | "reference.citation-local-collision"
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
