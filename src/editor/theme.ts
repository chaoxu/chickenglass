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
});
