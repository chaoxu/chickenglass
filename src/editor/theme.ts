import { EditorView } from "@codemirror/view";

/** Editor theme for chickenglass. */
export const chickenglassTheme = EditorView.theme({
  "&": {
    fontSize: "16px",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
  },
  ".cm-content": {
    padding: "24px 48px 24px 48px",
    maxWidth: "720px",
    margin: "0 auto",
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
    color: "#bbb",
    fontSize: "10px",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
  },
  ".cg-fold-toggle:hover": {
    color: "#666",
  },
  ".cm-cursor": {
    borderLeftColor: "#1a1a1a",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#d7e4f2",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },

  /* Document title from frontmatter — distinct from # section headings */
  ".cg-doc-title": {
    fontSize: "2.4em",
    fontWeight: "800",
    lineHeight: "1.2",
    color: "#111",
    marginBottom: "0.25em",
    paddingBottom: "0.15em",
    borderBottom: "1px solid #e8e8e8",
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
    color: "#888",
    fontWeight: "700",
  },
  ".cg-list-number": {
    color: "#888",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },

  /* Highlight styling (==text==) */
  ".cg-highlight": {
    backgroundColor: "#fff3a3",
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
    color: "#666",
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
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    backgroundColor: "rgba(0,0,0,0.06)",
    borderRadius: "3px",
    padding: "1px 4px",
  },

  /* Rendered link styling — shown when cursor is outside the link */
  ".cg-link-rendered": {
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",
  },

  /* Section numbers (rendered via ::before when cursor is outside) */
  "[data-section-number]::before": {
    content: "attr(data-section-number) '\\2002'",
    color: "#999",
    fontWeight: "400",
  },

  /* Header markers (# symbols) shown in muted color when editing */
  ".cg-heading-1 .tok-heading, .cg-heading-2 .tok-heading, .cg-heading-3 .tok-heading":
    {
      color: "#999",
    },

  /* Horizontal rule styling */
  ".cg-hr": {
    display: "block",
    textAlign: "center",
    fontSize: "0",
    borderBottom: "1px solid #ccc",
    margin: "0.5em 0",
  },

  /* Block header: rendered widget with optional KaTeX math */
  ".cg-block-header-rendered": {
    fontWeight: "bold",
  },

  /* Fenced div nesting guides — vertical lines on the left, editing only.
     Uses background-image so the line is strictly contained (no bleed). */
  ".cg-fence-d1": {
    backgroundImage: "linear-gradient(to right, #d8d8d8 2px, transparent 2px)",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0 0",
  },
  ".cg-fence-d2": {
    backgroundImage:
      "linear-gradient(to right, #d8d8d8 2px, transparent 2px), linear-gradient(to right, #c8c8c8 2px, transparent 2px)",
    backgroundPosition: "0 0, 8px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cg-fence-d3": {
    backgroundImage:
      "linear-gradient(to right, #d8d8d8 2px, transparent 2px), linear-gradient(to right, #c8c8c8 2px, transparent 2px), linear-gradient(to right, #b8b8b8 2px, transparent 2px)",
    backgroundPosition: "0 0, 8px 0, 16px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cg-fence-d4": {
    backgroundImage:
      "linear-gradient(to right, #d8d8d8 2px, transparent 2px), linear-gradient(to right, #c8c8c8 2px, transparent 2px), linear-gradient(to right, #b8b8b8 2px, transparent 2px), linear-gradient(to right, #a8a8a8 2px, transparent 2px)",
    backgroundPosition: "0 0, 8px 0, 16px 0, 24px 0",
    backgroundRepeat: "no-repeat",
  },

  /* QED tombstone — right-aligned ∎ at end of proof blocks */
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
    borderLeft: "3px solid #6cb4ee",
    backgroundColor: "#f0f7ff",
    paddingLeft: "1em",
    marginBottom: "0.5em",
  },

  /* Blockquote styling: applied to .cm-line elements via Decoration.line */
  ".cg-blockquote": {
    borderLeft: "4px solid #ccc",
    backgroundColor: "#f9f9f9",
    paddingLeft: "1em",
    color: "#555",
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
    borderRadius: "4px",
  },
  ".cg-image-error": {
    display: "inline-block",
    color: "#c00",
    fontStyle: "italic",
    fontSize: "0.85em",
    padding: "2px 6px",
    border: "1px solid #c00",
    borderRadius: "3px",
    verticalAlign: "middle",
  },

  /* Code block container */
  ".cg-codeblock": {
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    backgroundColor: "#f6f8fa",
    borderRadius: "4px",
  },

  /* Code block header: show language label via CSS ::before */
  ".cg-codeblock-header[data-language]::before": {
    content: "attr(data-language)",
    display: "inline-block",
    fontSize: "0.75em",
    color: "#666",
    backgroundColor: "#e8ecf0",
    borderRadius: "2px 2px 0 0",
    padding: "0 6px",
    marginBottom: "2px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  /* Source mode: subtle indication that fences are visible */
  ".cg-codeblock-source": {
    backgroundColor: "#fffbe6",
  },

  /* Table styles */
  ".cg-table .cm-line": {
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    fontSize: "0.9em",
  },

  ".cg-table-header": {
    fontWeight: "700",
  },

  ".cg-table-separator": {
    color: "#999",
    fontSize: "0.85em",
  },

  ".cg-table-pipe": {
    color: "#bbb",
  },

  /* Floating toolbar for table editing */
  ".cg-table-toolbar": {
    display: "flex",
    gap: "4px",
    padding: "4px 8px",
    backgroundColor: "#f5f5f5",
    border: "1px solid #ddd",
    borderRadius: "4px",
    marginBottom: "4px",
  },

  ".cg-table-toolbar-btn": {
    padding: "2px 8px",
    fontSize: "12px",
    border: "1px solid #ccc",
    borderRadius: "3px",
    backgroundColor: "#fff",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: "1.4",
    color: "#333",
  },

  ".cg-table-toolbar-btn:hover": {
    backgroundColor: "#e8e8e8",
    borderColor: "#999",
  },

  /* Math preview floating panel */
  ".cg-math-preview": {
    position: "fixed",
    zIndex: "1000",
    backgroundColor: "#fff",
    border: "1px solid #ccc",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    width: "fit-content",
    cursor: "grab",
  },
  ".cg-math-preview-content": {
    padding: "8px 12px",
  },

  /* Include region: right border spans the full height, label anchors to it */
  ".cg-include-region": {
    position: "relative",
    borderRight: "2px solid #e8e8e8",
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
    color: "#ccc",
    whiteSpace: "nowrap",
    letterSpacing: "0.3px",
    lineHeight: "1",
    zIndex: "1",
  },

  ".cg-include-label-active": {
    color: "#999",
  },

  /* Focus mode: dim non-active paragraphs */
  ".cg-focus-dimmed": {
    opacity: "0.3",
    transition: "opacity 0.15s",
  },

  /* Sidenote reference: superscript number */
  ".cg-sidenote-ref": {
    fontSize: "0.75em",
    color: "#a00",
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
    color: "#555",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
  },

  /* Sidenote number label */
  ".cg-sidenote-number": {
    fontSize: "0.75em",
    color: "#a00",
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
    overflow: "visible",
    padding: "0 !important",
    margin: "0",
  },
});
