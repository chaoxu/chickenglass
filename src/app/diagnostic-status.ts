import type { BibliographyStatus } from "../state/bib-data";
import type { FrontmatterStatus } from "../parser/frontmatter";
import type { ProjectConfigStatus } from "../project-config";
import type { DiagnosticCode, DiagnosticEntry } from "./diagnostic-types";

export function diagnosticFromFrontmatterStatus(
  status: FrontmatterStatus | undefined,
): DiagnosticEntry | null {
  if (status?.state !== "error") return null;
  return {
    severity: "error",
    source: "frontmatter",
    code: "frontmatter.parse",
    message: `Invalid frontmatter: ${status.message}`,
    from: status.from,
    to: status.to,
  };
}

export function diagnosticFromProjectConfigStatus(
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

export function diagnosticFromBibliographyStatus(
  status: BibliographyStatus | undefined,
): DiagnosticEntry | null {
  if (!status || (status.state !== "error" && status.state !== "warning")) {
    return null;
  }
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

export function diagnosticStatusKey(
  diagnostics: readonly DiagnosticEntry[],
): string {
  return JSON.stringify(diagnostics.map((diagnostic) => [
    diagnostic.severity,
    diagnostic.source,
    diagnostic.code,
    diagnostic.message,
    diagnostic.from,
    diagnostic.to,
  ]));
}
