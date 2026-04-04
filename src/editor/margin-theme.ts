import { contentFont, monoFont } from "../constants/editor-constants";
import {
  HOVER_PREVIEW_MAX_HEIGHT,
  HOVER_PREVIEW_MAX_WIDTH,
  SIDENOTE_NUMBER_MARGIN_RIGHT,
  SIDENOTE_OFFSET,
  SIDENOTE_WIDTH,
} from "../constants/layout";

/**
 * Margin and overlay styles: sidenotes (reference, definition, number,
 * content), math preview panel, and hover preview tooltips.
 */
export const marginThemeStyles = {
  /* Math preview floating panel */
  ".cf-math-preview": {
    position: "fixed",
    zIndex: "1000",
    backgroundColor: "var(--cf-bg)",
    border: "var(--cf-border-width) solid var(--cf-border)",
    borderRadius: "var(--cf-border-radius)",
    width: "fit-content",
    cursor: "grab",
  },
  ".cf-math-preview-content": {
    padding: "var(--cf-spacing-md) var(--cf-spacing-lg)",
    lineHeight: "1.6",
  },

  /* Sidenote reference: superscript number */
  ".cf-sidenote-ref": {
    fontSize: "0.75em",
    color: "var(--cf-fg)",
    cursor: "pointer",
    verticalAlign: "super",
    lineHeight: "0",
    fontWeight: "600",
  },

  /* Sidenote definition rendered in the right margin */
  ".cf-sidenote": {
    position: "absolute",
    right: SIDENOTE_OFFSET,
    width: SIDENOTE_WIDTH,
    fontSize: "0.8em",
    lineHeight: "1.4",
    color: "var(--cf-fg)",
    fontFamily: monoFont,
    transition: "transform var(--cf-transition, 0.15s ease)",
  },

  /* Sidenote number label */
  ".cf-sidenote-number": {
    fontSize: "0.75em",
    color: "var(--cf-fg)",
    fontWeight: "600",
    verticalAlign: "super",
    lineHeight: "0",
    marginRight: SIDENOTE_NUMBER_MARGIN_RIGHT,
  },

  /* Sidenote content */
  ".cf-sidenote-content": {
    display: "inline",
  },

  /* The definition line when sidenote is collapsed (hidden) */
  ".cf-sidenote-def-line": {
    position: "relative",
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* The definition line body in expanded mode — styled as footnote text */
  ".cf-sidenote-def-body": {
    fontSize: "0.85em",
    lineHeight: "1.5",
    color: "var(--cf-muted)",
  },

  /* The [^id]: label rendered as a small superscript number in expanded mode */
  ".cf-sidenote-def-label": {
    fontSize: "0.75em",
    color: "var(--cf-fg)",
    fontWeight: "600",
    verticalAlign: "super",
    lineHeight: "0",
    marginRight: "2px",
  },

  /* Hover preview tooltip for cross-references and citations */
  ".cf-hover-preview": {
    maxWidth: HOVER_PREVIEW_MAX_WIDTH,
    maxHeight: HOVER_PREVIEW_MAX_HEIGHT,
    overflow: "auto",
    padding: "var(--cf-spacing-sm) var(--cf-spacing-md)",
    fontSize: "0.9em",
    lineHeight: "1.5",
    fontFamily: contentFont,
  },
  ".cf-hover-preview-header": {
    fontWeight: "700",
    marginBottom: "var(--cf-spacing-xs)",
    color: "var(--cf-fg)",
  },
  ".cf-hover-preview-body": {
    color: "var(--cf-muted)",
  },
  /* Block-rendered content inside hover previews needs paragraph spacing */
  ".cf-hover-preview-body p": {
    margin: "0.25em 0",
  },
  ".cf-hover-preview-body p:first-child": {
    marginTop: "0",
  },
  ".cf-hover-preview-body p:last-child": {
    marginBottom: "0",
  },
  /* Display math inside hover previews — uses cf-math-display from markdownToHtml */
  ".cf-hover-preview-body .cf-math-display": {
    margin: "0",
    textAlign: "center",
  },
  ".cf-hover-preview-unresolved": {
    color: "var(--cf-muted)",
    fontStyle: "italic",
  },
  ".cf-citation-preview": {
    whiteSpace: "normal",
  },
  ".cf-hover-preview-citation": {
    color: "var(--cf-muted)",
    marginBottom: "var(--cf-spacing-xs)",
  },
  ".cf-hover-preview-citation:last-child": {
    marginBottom: "0",
  },
  ".cf-reference-completion-tooltip > ul": {
    maxHeight: "18em",
  },
  ".cf-reference-completion-citation": {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: "var(--cf-spacing-sm)",
    rowGap: "2px",
    alignItems: "start",
    paddingTop: "var(--cf-spacing-xs)",
    paddingBottom: "var(--cf-spacing-xs)",
  },
  ".cf-reference-completion-citation .cm-completionIcon": {
    gridColumn: "1",
    gridRow: "1 / span 2",
    marginTop: "2px",
    paddingRight: "0",
  },
  ".cf-reference-completion-citation .cm-completionLabel": {
    gridColumn: "2",
    fontWeight: "600",
    whiteSpace: "normal",
  },
  ".cf-reference-completion-citation .cf-citation-preview": {
    gridColumn: "2",
    fontSize: "0.9em",
    lineHeight: "1.45",
  },
  ".cf-hover-preview-separator": {
    border: "none",
    borderTop: "1px solid var(--cf-border)",
    margin: "var(--cf-spacing-xs) 0",
  },
};
