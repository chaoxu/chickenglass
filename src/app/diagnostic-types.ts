export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticSource =
  | "reference"
  | "math"
  | "footnote"
  | "frontmatter"
  | "project-config"
  | "bibliography"
  | "fenced-div"
  | "format";
export type DiagnosticCode =
  | "reference.duplicate-target"
  | "reference.citation-local-collision"
  | "reference.unresolved"
  | "math.render"
  | "footnote.orphan-definition"
  | "footnote.missing-definition"
  | "frontmatter.parse"
  | "project-config.read"
  | "project-config.parse"
  | "bibliography.read"
  | "bibliography.parse"
  | "bibliography.style"
  | "fenced-div.opener-trailing"
  | "format.html-comment"
  | "format.html-tag"
  | "format.reference-link-definition"
  | "format.bare-url-autolink";

/**
 * Optional repair action for a diagnostic. Renderers can surface this as a
 * button next to the diagnostic message; the controller executes it.
 */
export type DiagnosticFix =
  | {
    readonly kind: "open-bibliography";
    readonly bibPath: string;
    readonly label: string;
  }
  | {
    readonly kind: "insert-bibliography-stub";
    readonly bibPath: string;
    readonly id: string;
    readonly label: string;
  };

export interface DiagnosticEntry {
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Start position in the document (character offset). */
  readonly from: number;
  /** End position in the document (character offset). */
  readonly to: number;
  /** Optional repair action surfaced by the diagnostics UI. */
  readonly fix?: DiagnosticFix;
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
