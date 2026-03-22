import { monoFont } from "./editor-constants";

/**
 * Typography styles: document title, headings, inline formatting
 * (bold, italic, strikethrough, inline code), links, section numbers,
 * header markers, horizontal rules, hidden markers, lists, and highlights.
 */
export const typographyThemeStyles = {
  /* Document title from frontmatter — distinct from # section headings.
   * Scaled down to academic proportions (was 2.4em, now 1.6em). */
  ".cg-doc-title": {
    fontSize: "1.6em",
    fontWeight: "700",
    lineHeight: "1.3",
    color: "var(--cg-fg)",
    marginBottom: "0.25em",
    paddingBottom: "0.15em",
    borderBottom: "1px solid var(--cg-border)",
    display: "block",
    cursor: "text",
    userSelect: "none",
  },

  /* Hidden markers — source text stays in DOM but invisible */
  ".cg-hidden": {
    fontSize: "0",
    display: "inline",
    width: "0",
    overflow: "hidden",
  },

  /* List marker styling */
  ".cg-list-bullet": {
    color: "var(--cg-fg)",
    fontWeight: "700",
  },
  ".cg-list-number": {
    color: "var(--cg-fg)",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },

  /* Highlight styling (==text==) */
  ".cg-highlight": {
    backgroundColor: "var(--cg-hover)",
    borderRadius: "2px",
    padding: "1px 0",
  },

  /* Heading line styles — font-size on .cm-line so all children (including
   * math widgets) inherit it. Uses CSS variables from theme-config.ts so
   * presets can override sizes. */
  ".cg-heading-line-1": { fontSize: "var(--cg-h1-size, 1.15em)", lineHeight: "1.3", color: "var(--cg-fg)" },
  ".cg-heading-line-2": { fontSize: "var(--cg-h2-size, 1.15em)", lineHeight: "1.3", color: "var(--cg-fg)" },
  ".cg-heading-line-3": { fontSize: "var(--cg-h3-size, 1.1em)", lineHeight: "1.4", color: "var(--cg-fg)" },
  ".cg-heading-line-4": { fontSize: "var(--cg-h4-size, 1.05em)", lineHeight: "1.4", color: "var(--cg-fg)" },
  ".cg-heading-line-5": { fontSize: "var(--cg-h5-size, 1em)", lineHeight: "1.5", color: "var(--cg-fg)" },
  ".cg-heading-line-6": { fontSize: "var(--cg-h6-size, 0.95em)", lineHeight: "1.5", color: "var(--cg-fg)" },

  /* Heading mark styles — font-weight/style on text spans.
   * Uses CSS variables from theme-config.ts so presets can override. */
  ".cg-heading-1": { fontWeight: "var(--cg-h1-weight, 700)", fontStyle: "var(--cg-h1-style, normal)" },
  ".cg-heading-2": { fontWeight: "var(--cg-h2-weight, 400)", fontStyle: "var(--cg-h2-style, italic)" },
  ".cg-heading-3": { fontWeight: "var(--cg-h3-weight, 600)", fontStyle: "var(--cg-h3-style, italic)" },
  ".cg-heading-4": { fontWeight: "var(--cg-h4-weight, 600)", fontStyle: "var(--cg-h4-style, normal)" },
  ".cg-heading-5": { fontWeight: "var(--cg-h5-weight, 600)", fontStyle: "var(--cg-h5-style, normal)" },
  ".cg-heading-6": { fontWeight: "var(--cg-h6-weight, 600)", fontStyle: "var(--cg-h6-style, normal)" },

  /* Inline content styling — always applied for WYSIWYG feel */
  ".cg-bold": {
    fontWeight: "700",
  },
  ".cg-italic": {
    fontStyle: "italic",
  },
  ".cg-strikethrough": {
    textDecoration: "line-through",
  },
  ".cg-inline-code": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cg-subtle)",
    borderRadius: "2px",
    padding: "1px 4px",
  },

  /* Rendered link styling — shown when cursor is outside the link */
  ".cg-link-rendered": {
    color: "var(--cg-fg)",
    textDecoration: "underline",
    cursor: "pointer",
  },

  /* Section numbers (rendered via ::before when cursor is outside).
   * Period after number matches blog's .header-section-number:after style. */
  "[data-section-number]::before": {
    content: "attr(data-section-number) '.\\2002'",
    color: "var(--cg-fg)",
    fontWeight: "400",
    marginRight: "4px",
  },

  /* Source syntax elements use monospace — heading markers (#), math
   * delimiters ($, $$, \[, \]), fenced div fences (:::), list markers.
   * The base editor font is serif for rendered text, but syntax characters
   * need monospace for alignment and visual distinction. */
  ".tok-meta, .tok-processingInstruction, .tok-url": {
    fontFamily: monoFont,
    color: "var(--cg-fg)",
  },

  /* Math source content — LaTeX between $ delimiters when editing */
  ".cg-math-source": {
    fontFamily: monoFont,
  },

  /* Header markers (# symbols) shown in muted color when editing. */
  ".cg-heading-1 .tok-heading.tok-meta, .cg-heading-2 .tok-heading.tok-meta, .cg-heading-3 .tok-heading.tok-meta":
    {
      color: "var(--cg-muted)",
      fontFamily: monoFont,
    },
  /* Heading text should use foreground color and inherit serif font */
  ".cg-heading-1 .tok-heading, .cg-heading-2 .tok-heading, .cg-heading-3 .tok-heading, .cg-heading-4 .tok-heading, .cg-heading-5 .tok-heading, .cg-heading-6 .tok-heading":
    {
      color: "var(--cg-fg)",
    },

  /* Horizontal rule styling */
  ".cg-hr": {
    display: "block",
    textAlign: "center",
    fontSize: "0",
    borderBottom: "1px solid var(--cg-border)",
    margin: "0.5em 0",
  },
};
