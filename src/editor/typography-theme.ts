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
   * math widgets) inherit it. Matches Oxford Lecture Series / blog style. */
  ".cg-heading-line-1": { fontSize: "1.15em", lineHeight: "1.3", color: "var(--cg-fg)" },
  ".cg-heading-line-2": { fontSize: "1.15em", lineHeight: "1.3", color: "var(--cg-fg)" },
  ".cg-heading-line-3": { fontSize: "1.1em", lineHeight: "1.4", color: "var(--cg-fg)" },
  ".cg-heading-line-4": { fontSize: "1.05em", lineHeight: "1.4", color: "var(--cg-fg)" },
  ".cg-heading-line-5": { fontSize: "1em", lineHeight: "1.5", color: "var(--cg-fg)" },
  ".cg-heading-line-6": { fontSize: "0.95em", lineHeight: "1.5", color: "var(--cg-fg)" },

  /* Heading mark styles — font-weight/style on text spans.
   * H1: bold, H2: italic normal-weight, H3: italic bold (blog style) */
  ".cg-heading-1": { fontWeight: "700" },
  ".cg-heading-2": { fontWeight: "400", fontStyle: "italic" },
  ".cg-heading-3": { fontWeight: "600", fontStyle: "italic" },
  ".cg-heading-4": { fontWeight: "600" },
  ".cg-heading-5": { fontWeight: "600" },
  ".cg-heading-6": { fontWeight: "600" },

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
  ".tok-meta, .tok-processingInstruction": {
    fontFamily: monoFont,
    color: "var(--cg-fg)",
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
