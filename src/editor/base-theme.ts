
/**
 * Base editor chrome styles: container, content area, gutters, cursor,
 * selection, active line, and fold toggles.
 */
export const baseThemeStyles = {
  "&": {
    fontSize: "var(--cf-base-font-size, 16px)",
    fontFamily: "var(--cf-content-font, KaTeX_Main, 'Times New Roman', serif)",
  },
  ".cm-content": {
    fontFamily: "var(--cf-content-font, KaTeX_Main, 'Times New Roman', serif)",
    padding: "24px 48px 24px 48px",
    maxWidth: "var(--cf-content-max-width, 800px)",
    marginLeft: "auto",
    marginRight: "max(224px, calc((100% - 800px) / 2))",
    overflow: "visible",
  },
  ".cm-gutters": {
    display: "none",
  },
  /* Fold toggle sits in the left margin outside the line */
  ".cf-fold-line": {
    position: "relative",
  },
  ".cf-fold-toggle": {
    position: "absolute",
    right: "100%",
    marginRight: "4px",
    color: "var(--cf-border)",
    fontSize: "14px",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
    opacity: "0",
    transition: "opacity 0.15s",
  },
  /* Show fold toggle when hovering the heading line */
  ".cm-line:hover .cf-fold-toggle": {
    opacity: "1",
  },
  /* Always show fold toggle when section is folded */
  ".cf-fold-toggle-folded": {
    opacity: "1",
  },
  ".cf-fold-toggle:hover": {
    color: "var(--cf-fg)",
  },
  /* Fold toggle sizes per heading level */
  ".cf-fold-h1": { fontSize: "24px" },
  ".cf-fold-h2": { fontSize: "20px" },
  ".cf-fold-h3": { fontSize: "16px" },
  ".cm-cursor": {
    borderLeftColor: "var(--cf-fg)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--cf-hover)",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },

  /* Focus mode: dim non-active paragraphs */
  ".cf-focus-dimmed": {
    opacity: "0.3",
    transition: "opacity 0.15s",
  },
};
