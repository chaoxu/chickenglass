import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { DiagnosticEntry } from "./diagnostic-types";

/**
 * FORMAT.md conformance diagnostics.
 *
 * Detects Pandoc/CommonMark constructs that are intentionally out-of-scope
 * for the canonical Coflat surface (see FORMAT.md "Removed Features"). These
 * fire as warnings, not errors — the underlying parser still accepts them
 * for read/export compatibility, but authoring should avoid them.
 *
 * Detection works off the Lezer syntax tree so it is fail-safe with respect
 * to fenced code blocks (which are their own subtree) and inline code spans
 * (which are tagged `InlineCode` and contain no inline children).
 *
 * Detection is intentionally conservative — false negatives are acceptable;
 * false positives are not.
 */
export function extractFormatDiagnostics(state: EditorState): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      const name = node.name;
      if (name === "Comment") {
        diagnostics.push({
          severity: "warning",
          source: "format",
          code: "format.html-comment",
          message:
            "HTML comments (<!-- ... -->) are not part of the Coflat document surface. Remove the comment or move the content into prose.",
          from: node.from,
          to: node.to,
        });
        return;
      }
      if (name === "HTMLTag") {
        diagnostics.push({
          severity: "warning",
          source: "format",
          code: "format.html-tag",
          message:
            "Raw inline HTML is not part of the Coflat document surface. Use a fenced div or markdown construct instead.",
          from: node.from,
          to: node.to,
        });
        return;
      }
      if (name === "LinkReference") {
        diagnostics.push({
          severity: "warning",
          source: "format",
          code: "format.reference-link-definition",
          message:
            "Reference-style link definitions ([id]: url) are not part of the Coflat document surface. Use inline links [text](url) instead.",
          from: node.from,
          to: node.to,
        });
        return;
      }
      if (name === "Autolink") {
        diagnostics.push({
          severity: "warning",
          source: "format",
          code: "format.bare-url-autolink",
          message:
            "Bare URL autolinks (<https://...>) are not part of the Coflat document surface. Use an inline link [text](url) instead.",
          from: node.from,
          to: node.to,
        });
      }
    },
  });

  return diagnostics;
}
