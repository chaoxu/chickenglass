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

  /* Horizontal rule styling */
  ".cg-hr": {
    display: "block",
    textAlign: "center",
    fontSize: "0",
    borderBottom: "1px solid #ccc",
    margin: "0.5em 0",
  },
});
