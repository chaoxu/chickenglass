/**
 * Base editor chrome styles: container, content area, gutters, cursor,
 * selection, active line, and fold toggles.
 */
export const baseThemeStyles = {
  "&": {
    fontSize: "16px",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
  },
  ".cm-content": {
    padding: "24px 48px 24px 48px",
    maxWidth: "800px",
    marginLeft: "auto",
    marginRight: "max(224px, calc((100% - 800px) / 2))",
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
    fontSize: "14px",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
    opacity: "0",
    transition: "opacity 0.15s",
  },
  /* Show fold toggle when hovering the heading line */
  ".cm-line:hover .cg-fold-toggle": {
    opacity: "1",
  },
  /* Always show fold toggle when section is folded */
  ".cg-fold-toggle-folded": {
    opacity: "1",
  },
  ".cg-fold-toggle:hover": {
    color: "var(--cg-fg)",
  },
  /* Fold toggle sizes per heading level */
  ".cg-fold-h1": { fontSize: "24px" },
  ".cg-fold-h2": { fontSize: "20px" },
  ".cg-fold-h3": { fontSize: "16px" },
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

  /* Focus mode: dim non-active paragraphs */
  ".cg-focus-dimmed": {
    opacity: "0.3",
    transition: "opacity 0.15s",
  },
};
