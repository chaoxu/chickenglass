import { EditorView } from "@codemirror/view";

/** Editor theme for chickenglass. */
export const chickenglassTheme = EditorView.theme({
  "&": {
    fontSize: "16px",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
  },
  ".cm-content": {
    padding: "24px 48px",
    maxWidth: "720px",
    margin: "0 auto",
  },
  ".cm-gutters": {
    display: "none",
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

  /* Hidden markers — source text stays in DOM but invisible */
  ".cg-hidden": {
    fontSize: "0",
    display: "inline",
    width: "0",
    overflow: "hidden",
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

  /* Block header: show label via CSS ::before pseudo-element */
  ".cg-block-header[data-block-label]::before": {
    content: "attr(data-block-label) ' '",
    fontWeight: "bold",
  },

  /* Blockquote styling: left border, muted background, padding */
  ".cg-blockquote": {
    display: "block",
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
});
