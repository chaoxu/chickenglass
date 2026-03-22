import { monoFont } from "./editor-constants";

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
    border: "1px solid var(--cf-border)",
    borderRadius: "2px",
    width: "fit-content",
    cursor: "grab",
  },
  ".cf-math-preview-content": {
    padding: "12px 16px",
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
    right: "-280px",
    width: "240px",
    fontSize: "0.8em",
    lineHeight: "1.4",
    color: "var(--cf-fg)",
    fontFamily: monoFont,
    transition: "transform 0.15s ease-out",
  },

  /* Sidenote number label */
  ".cf-sidenote-number": {
    fontSize: "0.75em",
    color: "var(--cf-fg)",
    fontWeight: "600",
    verticalAlign: "super",
    lineHeight: "0",
    marginRight: "3px",
  },

  /* Sidenote content */
  ".cf-sidenote-content": {
    display: "inline",
  },

  /* The definition line when sidenote is shown in margin */
  ".cf-sidenote-def-line": {
    position: "relative",
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Hover preview tooltip for cross-references and citations */
  ".cf-hover-preview": {
    maxWidth: "400px",
    maxHeight: "300px",
    overflow: "auto",
    padding: "8px 12px",
    fontSize: "0.9em",
    lineHeight: "1.5",
    fontFamily: monoFont,
  },
  ".cf-hover-preview-header": {
    fontWeight: "700",
    marginBottom: "4px",
    color: "var(--cf-fg)",
  },
  ".cf-hover-preview-body": {
    color: "var(--cf-muted)",
    whiteSpace: "pre-wrap",
  },
  ".cf-hover-preview-unresolved": {
    color: "var(--cf-muted)",
    fontStyle: "italic",
  },
  ".cf-hover-preview-citation": {
    color: "var(--cf-muted)",
    marginBottom: "4px",
  },
  ".cf-hover-preview-citation:last-child": {
    marginBottom: "0",
  },
};
