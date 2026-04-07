import { monoFont } from "../constants/editor-constants";
import {
  SIDENOTE_NUMBER_MARGIN_RIGHT,
  SIDENOTE_OFFSET,
  SIDENOTE_WIDTH,
} from "../constants/layout";

/**
 * Margin and overlay styles: sidenotes (reference, definition, number,
 * content), math preview panel, and hover preview tooltips.
 */
export const marginThemeStyles = {
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

  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip": {
    backgroundColor: "var(--cf-bg)",
    border: "1px solid var(--cf-border)",
    borderRadius: "8px",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    color: "var(--cf-fg)",
    fontFamily: "var(--cf-ui-font)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul": {
    boxSizing: "border-box",
    height: "auto",
    maxHeight: "32em",
    maxWidth: "min(52rem, calc(100vw - 1rem))",
    minWidth: "24rem",
    overflowX: "hidden",
    overflowY: "auto",
    padding: "var(--cf-spacing-xs)",
    whiteSpace: "normal",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul > li": {
    borderRadius: "var(--cf-border-radius-lg)",
    color: "var(--cf-fg)",
    lineHeight: "1.4",
    margin: "2px 0",
    overflowX: "visible",
    padding: "var(--cf-spacing-xs) var(--cf-spacing-sm)",
    textOverflow: "clip",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul > li[aria-selected]": {
    backgroundColor: "var(--cf-hover)",
    color: "var(--cf-fg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]": {
    backgroundColor: "var(--cf-active)",
    color: "var(--cf-muted)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul > completion-section": {
    borderBottom: "1px solid var(--cf-border)",
    color: "var(--cf-muted)",
    fontFamily: "var(--cf-ui-font)",
    padding: "var(--cf-spacing-xs) var(--cf-spacing-sm)",
  },
  ".cf-reference-completion-preview": {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    columnGap: "var(--cf-spacing-sm)",
    rowGap: "2px",
    alignItems: "start",
    paddingTop: "var(--cf-spacing-xs)",
    paddingBottom: "var(--cf-spacing-xs)",
  },
  ".cf-reference-completion-preview .cm-completionIcon": {
    display: "none",
  },
  ".cf-reference-completion-preview .cm-completionLabel": {
    gridColumn: "1",
    color: "inherit",
    fontFamily: "var(--cf-ui-font)",
    fontWeight: "600",
    lineHeight: "1.35",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  ".cf-reference-completion-preview .cm-completionDetail": {
    gridColumn: "2",
    color: "var(--cf-muted)",
    fontFamily: "var(--cf-ui-font)",
    fontSize: "0.82em",
    marginLeft: "0",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  ".cf-reference-completion-crossref .cf-reference-completion-content": {
    gridColumn: "1 / span 2",
    display: "flex",
    flexDirection: "column",
    gap: "var(--cf-spacing-xs)",
    minWidth: "0",
    padding: "var(--cf-spacing-xs) 0 0",
  },
  ".cf-reference-completion-crossref .cf-reference-completion-content .cf-hover-preview-header": {
    fontFamily: "var(--cf-ui-font)",
    lineHeight: "1.35",
    marginBottom: "0",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  ".cf-reference-completion-crossref .cf-reference-completion-content .cf-hover-preview-body": {
    minWidth: "0",
    overflowWrap: "anywhere",
  },
  ".cf-reference-completion-crossref .cf-reference-completion-meta": {
    color: "var(--cf-muted)",
    fontFamily: "var(--cf-ui-font)",
    fontSize: "0.82em",
    fontWeight: "600",
  },
  ".cf-reference-completion-citation .cf-citation-preview": {
    gridColumn: "1 / span 2",
    fontSize: "0.9em",
    lineHeight: "1.45",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  ".cf-reference-completion-preview .katex": {
    fontSize: "1em",
  },
  ".cf-reference-completion-preview .katex-display": {
    fontSize: "1em",
  },
  ".cf-reference-completion-preview .katex-display > .katex": {
    fontSize: "1em",
  },
};
