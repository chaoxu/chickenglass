import { EditorView } from "@codemirror/view";

const monoFont = "'IBM Plex Mono', 'Fira Code', monospace";

/**
 * Base editor theme for chickenglass — uses CSS custom properties so that
 * light/dark switching only requires changing variables on the html element.
 */
export const chickenglassTheme = EditorView.theme({
  "&": {
    fontSize: "16px",
    fontFamily: monoFont,
  },
  ".cm-content": {
    padding: "24px 48px 24px 48px",
    maxWidth: "720px",
    marginRight: "224px", // leave room for sidenote margin column
    overflow: "visible",
  },
  ".cm-gutters": {
    display: "none",
  },
  /* Fold toggle sits in the left margin outside the line */
  ".cg-fold-line": {
    position: "relative",
  },
  ".cg-fold-toggle": {
    position: "absolute",
    right: "100%",
    marginRight: "4px",
    color: "var(--cg-border)",
    fontSize: "10px",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
  },
  ".cg-fold-toggle:hover": {
    color: "var(--cg-fg)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--cg-fg)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--cg-hover)",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },

  /* Document title from frontmatter — distinct from # section headings */
  ".cg-doc-title": {
    fontSize: "2.4em",
    fontWeight: "800",
    lineHeight: "1.2",
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
    color: "var(--cg-muted)",
    fontWeight: "700",
  },
  ".cg-list-number": {
    color: "var(--cg-muted)",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },

  /* Highlight styling (==text==) */
  ".cg-highlight": {
    backgroundColor: "var(--cg-hover)",
    borderRadius: "2px",
    padding: "1px 0",
  },

  /* Heading styles */
  ".cg-heading-1": {
    fontSize: "2em",
    fontWeight: "700",
    lineHeight: "1.2",
  },
  ".cg-heading-2": {
    fontSize: "1.5em",
    fontWeight: "700",
    lineHeight: "1.3",
  },
  ".cg-heading-3": {
    fontSize: "1.25em",
    fontWeight: "600",
    lineHeight: "1.4",
  },
  ".cg-heading-4": {
    fontSize: "1.1em",
    fontWeight: "600",
    lineHeight: "1.4",
  },
  ".cg-heading-5": {
    fontSize: "1em",
    fontWeight: "600",
    lineHeight: "1.5",
  },
  ".cg-heading-6": {
    fontSize: "0.9em",
    fontWeight: "600",
    lineHeight: "1.5",
    color: "var(--cg-muted)",
  },

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

  /* Section numbers (rendered via ::before when cursor is outside) */
  "[data-section-number]::before": {
    content: "attr(data-section-number) '\\2002'",
    color: "var(--cg-muted)",
    fontWeight: "400",
  },

  /* Header markers (# symbols) shown in muted color when editing */
  ".cg-heading-1 .tok-heading, .cg-heading-2 .tok-heading, .cg-heading-3 .tok-heading":
    {
      color: "var(--cg-muted)",
    },

  /* Horizontal rule styling */
  ".cg-hr": {
    display: "block",
    textAlign: "center",
    fontSize: "0",
    borderBottom: "1px solid var(--cg-border)",
    margin: "0.5em 0",
  },

  /* Block header: rendered widget with optional KaTeX math */
  ".cg-block-header-rendered": {
    fontWeight: "bold",
  },

  /* Fenced div nesting guides — vertical lines on the left, editing only.
     Uses inset box-shadow so the guide never shifts content layout. */
  ".cg-fence-d1": {
    boxShadow: "inset 3px 0 0 var(--cg-border)",
  },
  ".cg-fence-d2": {
    boxShadow: "inset 3px 0 0 var(--cg-active)",
  },
  ".cg-fence-d3": {
    boxShadow: "inset 3px 0 0 var(--cg-muted)",
  },
  ".cg-fence-d4": {
    boxShadow: "inset 3px 0 0 var(--cg-fg)",
  },

  /* QED tombstone — right-aligned at end of proof blocks */
  ".cg-block-qed::after": {
    content: "'\\220E'",
    float: "right",
    fontSize: "1.2em",
    lineHeight: "1",
  },

  /* Include fence lines — collapsed to zero height for seamless flow */
  ".cg-include-fence": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Include block styling */
  ".cg-block-include": {
    borderLeft: "2px solid var(--cg-border)",
    paddingLeft: "1em",
    marginBottom: "0.5em",
  },

  /* Blockquote styling: applied to .cm-line elements via Decoration.line */
  ".cg-blockquote": {
    borderLeft: "2px solid var(--cg-border)",
    paddingLeft: "1em",
    color: "var(--cg-muted)",
    fontStyle: "italic",
  },

  /* Inline image preview */
  ".cg-image-wrapper": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "100%",
  },
  ".cg-image": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "400px",
  },
  ".cg-image-error": {
    display: "inline-block",
    color: "var(--cg-fg)",
    fontStyle: "italic",
    fontSize: "0.85em",
    padding: "2px 6px",
    border: "1px solid var(--cg-fg)",
    borderRadius: "2px",
    verticalAlign: "middle",
  },

  /* Code block container */
  ".cg-codeblock": {
    fontFamily: monoFont,
    backgroundColor: "var(--cg-subtle)",
    borderRadius: "2px",
  },

  /* Code block header: show language label via CSS ::before */
  ".cg-codeblock-header[data-language]::before": {
    content: "attr(data-language)",
    display: "inline-block",
    fontSize: "0.75em",
    color: "var(--cg-muted)",
    padding: "0 6px",
    marginBottom: "2px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  /* Source mode: subtle indication that fences are visible */
  ".cg-codeblock-source": {
    backgroundColor: "var(--cg-subtle)",
  },

  /* Table styles */
  ".cg-table .cm-line": {
    fontFamily: monoFont,
    fontSize: "0.9em",
  },

  ".cg-table-header": {
    fontWeight: "700",
  },

  ".cg-table-separator": {
    color: "var(--cg-muted)",
    fontSize: "0.85em",
  },

  ".cg-table-pipe": {
    color: "var(--cg-border)",
  },

  /* Floating toolbar for table editing */
  ".cg-table-toolbar": {
    display: "flex",
    gap: "4px",
    padding: "4px 8px",
    backgroundColor: "var(--cg-subtle)",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
    marginBottom: "4px",
  },

  ".cg-table-toolbar-btn": {
    padding: "2px 8px",
    fontSize: "12px",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
    backgroundColor: "var(--cg-bg)",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: "1.4",
    color: "var(--cg-fg)",
  },

  ".cg-table-toolbar-btn:hover": {
    backgroundColor: "var(--cg-hover)",
  },

  /* Math preview floating panel */
  ".cg-math-preview": {
    position: "fixed",
    zIndex: "1000",
    backgroundColor: "var(--cg-bg)",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
    width: "fit-content",
    cursor: "grab",
  },
  ".cg-math-preview-content": {
    padding: "8px 12px",
  },

  /* Include region: right border spans the full height, label anchors to it */
  ".cg-include-region": {
    position: "relative",
    borderRight: "1px solid var(--cg-border)",
  },

  /* Include label: rotated filename inside the right padding of .cm-content */
  ".cg-include-label": {
    position: "absolute",
    right: "-44px",
    top: "2px",
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    userSelect: "none",
    pointerEvents: "none",
    fontSize: "10px",
    color: "var(--cg-border)",
    whiteSpace: "nowrap",
    letterSpacing: "0.3px",
    lineHeight: "1",
    zIndex: "1",
  },

  ".cg-include-label-active": {
    color: "var(--cg-muted)",
  },

  /* Focus mode: dim non-active paragraphs */
  ".cg-focus-dimmed": {
    opacity: "0.3",
    transition: "opacity 0.15s",
  },

  /* Sidenote reference: superscript number */
  ".cg-sidenote-ref": {
    fontSize: "0.75em",
    color: "var(--cg-fg)",
    cursor: "pointer",
    verticalAlign: "super",
    lineHeight: "0",
    fontWeight: "600",
  },

  /* Sidenote definition rendered in the right margin */
  ".cg-sidenote": {
    position: "absolute",
    right: "-280px",
    width: "240px",
    fontSize: "0.8em",
    lineHeight: "1.4",
    color: "var(--cg-muted)",
    fontFamily: monoFont,
    transition: "transform 0.15s ease-out",
  },

  /* Sidenote number label */
  ".cg-sidenote-number": {
    fontSize: "0.75em",
    color: "var(--cg-fg)",
    fontWeight: "600",
    verticalAlign: "super",
    lineHeight: "0",
    marginRight: "3px",
  },

  /* Sidenote content */
  ".cg-sidenote-content": {
    display: "inline",
  },

  /* The definition line when sidenote is shown in margin */
  ".cg-sidenote-def-line": {
    position: "relative",
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Hover preview tooltip for cross-references and citations */
  ".cg-hover-preview": {
    maxWidth: "400px",
    maxHeight: "300px",
    overflow: "auto",
    padding: "8px 12px",
    fontSize: "0.9em",
    lineHeight: "1.5",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
  },
  ".cg-hover-preview-header": {
    fontWeight: "700",
    marginBottom: "4px",
    color: "var(--cg-fg)",
  },
  ".cg-hover-preview-body": {
    color: "var(--cg-muted)",
    whiteSpace: "pre-wrap",
  },
  ".cg-hover-preview-unresolved": {
    color: "var(--cg-error)",
    fontStyle: "italic",
  },
  ".cg-hover-preview-citation": {
    color: "var(--cg-muted)",
    marginBottom: "4px",
  },
  ".cg-hover-preview-citation:last-child": {
    marginBottom: "0",
  },
});

/**
 * CM6 dark-mode base theme — tells CodeMirror the background is dark so it
 * picks appropriate defaults for its own UI (scroll gutter, etc.).
 * Applied when the resolved theme is "dark".
 */
export const chickenglasDarkTheme = EditorView.theme(
  {
    "&": {
      colorScheme: "dark",
    },
  },
  { dark: true },
);
