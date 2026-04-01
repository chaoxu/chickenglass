
import {
  CONTENT_MAX_WIDTH,
  CONTENT_PADDING_X,
  CONTENT_PADDING_Y,
  MARGIN_RIGHT_CALC,
} from "../constants/layout";

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
    padding: `${CONTENT_PADDING_Y} ${CONTENT_PADDING_X} ${CONTENT_PADDING_Y} ${CONTENT_PADDING_X}`,
    maxWidth: `var(--cf-content-max-width, ${CONTENT_MAX_WIDTH})`,
    marginLeft: "auto",
    marginRight: `max(var(--cf-sidenote-width, ${MARGIN_RIGHT_CALC}), calc((100% - var(--cf-content-max-width, ${CONTENT_MAX_WIDTH})) / 2))`,
    overflow: "visible",
    lineHeight: "var(--cf-line-height)",
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
    marginRight: "var(--cf-spacing-xs)",
    color: "var(--cf-border)",
    fontSize: "var(--cf-ui-font-size-base)",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
    opacity: "0",
    transition: "opacity var(--cf-transition, 0.15s ease)",
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
    borderLeftWidth: "var(--cf-border-width-accent)",
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
    transition: "opacity var(--cf-transition, 0.15s ease)",
  },
};
