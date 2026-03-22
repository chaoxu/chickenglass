import { monoFont } from "./editor-constants";

/**
 * Typography styles: document title, headings, inline formatting
 * (bold, italic, strikethrough, inline code), links, section numbers,
 * header markers, horizontal rules, hidden markers, lists, and highlights.
 */
export const typographyThemeStyles = {
  /* Document title from frontmatter — distinct from # section headings.
   * Scaled down to academic proportions (was 2.4em, now 1.6em). */
  ".cf-doc-title": {
    fontSize: "1.6em",
    fontWeight: "700",
    lineHeight: "1.3",
    color: "var(--cf-fg)",
    marginBottom: "0.25em",
    paddingBottom: "0.15em",
    borderBottom: "var(--cf-border-width) solid var(--cf-border)",
    display: "block",
    cursor: "text",
    userSelect: "none",
  },

  /* Hidden markers — source text stays in DOM but invisible */
  ".cf-hidden": {
    fontSize: "0",
    display: "inline",
    width: "0",
    overflow: "hidden",
  },

  /* List marker styling */
  ".cf-list-bullet": {
    color: "var(--cf-fg)",
    fontWeight: "700",
  },
  ".cf-list-number": {
    color: "var(--cf-fg)",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },

  /* Highlight styling (==text==) */
  ".cf-highlight": {
    backgroundColor: "var(--cf-hover)",
    borderRadius: "var(--cf-border-radius)",
    padding: "1px 0",
  },

  /* Heading line styles — font-size on .cm-line so all children (including
   * math widgets) inherit it. Uses CSS variables from theme-config.ts so
   * presets can override sizes. */
  ".cf-heading-line-1": { fontSize: "var(--cf-h1-size, 1.15em)", lineHeight: "1.3", color: "var(--cf-fg)" },
  ".cf-heading-line-2": { fontSize: "var(--cf-h2-size, 1.15em)", lineHeight: "1.3", color: "var(--cf-fg)" },
  ".cf-heading-line-3": { fontSize: "var(--cf-h3-size, 1.1em)", lineHeight: "1.4", color: "var(--cf-fg)" },
  ".cf-heading-line-4": { fontSize: "var(--cf-h4-size, 1.05em)", lineHeight: "1.4", color: "var(--cf-fg)" },
  ".cf-heading-line-5": { fontSize: "var(--cf-h5-size, 1em)", lineHeight: "1.5", color: "var(--cf-fg)" },
  ".cf-heading-line-6": { fontSize: "var(--cf-h6-size, 0.95em)", lineHeight: "1.5", color: "var(--cf-fg)" },

  /* Heading mark styles — font-weight/style on text spans.
   * Uses CSS variables from theme-config.ts so presets can override. */
  ".cf-heading-1": { fontWeight: "var(--cf-h1-weight, 700)", fontStyle: "var(--cf-h1-style, normal)" },
  ".cf-heading-2": { fontWeight: "var(--cf-h2-weight, 400)", fontStyle: "var(--cf-h2-style, italic)" },
  ".cf-heading-3": { fontWeight: "var(--cf-h3-weight, 600)", fontStyle: "var(--cf-h3-style, italic)" },
  ".cf-heading-4": { fontWeight: "var(--cf-h4-weight, 600)", fontStyle: "var(--cf-h4-style, normal)" },
  ".cf-heading-5": { fontWeight: "var(--cf-h5-weight, 600)", fontStyle: "var(--cf-h5-style, normal)" },
  ".cf-heading-6": { fontWeight: "var(--cf-h6-weight, 600)", fontStyle: "var(--cf-h6-style, normal)" },

  /* Inline content styling — always applied for WYSIWYG feel */
  ".cf-bold": {
    fontWeight: "700",
  },
  ".cf-italic": {
    fontStyle: "italic",
  },
  ".cf-strikethrough": {
    textDecoration: "line-through",
  },
  ".cf-inline-code": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
    borderRadius: "var(--cf-border-radius)",
    padding: "1px 4px",
  },

  /* Rendered link styling — shown when cursor is outside the link */
  ".cf-link-rendered": {
    color: "var(--cf-fg)",
    textDecoration: "underline",
    cursor: "pointer",
  },

  /* Section numbers (rendered via ::before when cursor is outside).
   * Period after number matches blog's .header-section-number:after style. */
  "[data-section-number]::before": {
    content: "attr(data-section-number) '.\\2002'",
    color: "var(--cf-fg)",
    fontWeight: "400",
    marginRight: "var(--cf-spacing-xs)",
  },

  /* Source syntax elements use monospace — heading markers (#), math
   * delimiters ($, $$, \[, \]), fenced div fences (:::), list markers.
   * The base editor font is serif for rendered text, but syntax characters
   * need monospace for alignment and visual distinction. */
  ".tok-meta, .tok-processingInstruction, .tok-url": {
    fontFamily: monoFont,
    color: "var(--cf-fg)",
  },

  /* Math source content — LaTeX between $ delimiters when editing */
  ".cf-math-source": {
    fontFamily: monoFont,
  },

  /* Header markers (# symbols) shown in muted color when editing. */
  ".cf-heading-1 .tok-heading.tok-meta, .cf-heading-2 .tok-heading.tok-meta, .cf-heading-3 .tok-heading.tok-meta":
    {
      color: "var(--cf-muted)",
      fontFamily: monoFont,
    },
  /* Heading text should use foreground color and inherit serif font */
  ".cf-heading-1 .tok-heading, .cf-heading-2 .tok-heading, .cf-heading-3 .tok-heading, .cf-heading-4 .tok-heading, .cf-heading-5 .tok-heading, .cf-heading-6 .tok-heading":
    {
      color: "var(--cf-fg)",
    },

  /* Horizontal rule styling */
  ".cf-hr": {
    display: "block",
    textAlign: "center",
    fontSize: "0",
    borderBottom: "var(--cf-border-width) solid var(--cf-border)",
    margin: "0.5em 0",
  },
};
