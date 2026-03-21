import { monoFont } from "./editor-constants";

/**
 * Margin and overlay styles: sidenotes (reference, definition, number,
 * content), math preview panel, and hover preview tooltips.
 */
export const marginThemeStyles = {
  /* Math preview floating panel */
  ".cg-math-preview": {
    position: "fixed",
    zIndex: "1000",
    backgroundColor: "var(--cg-bg)",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
    width: "fit-content",
    cursor: "grab",
  },
  ".cg-math-preview-content": {
    padding: "12px 16px",
    lineHeight: "1.6",
  },

  /* Sidenote reference: superscript number */
  ".cg-sidenote-ref": {
    fontSize: "0.75em",
    color: "var(--cg-fg)",
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
    color: "var(--cg-fg)",
    fontFamily: monoFont,
    transition: "transform 0.15s ease-out",
  },

  /* Sidenote number label */
  ".cg-sidenote-number": {
    fontSize: "0.75em",
    color: "var(--cg-fg)",
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
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Hover preview tooltip for cross-references and citations */
  ".cg-hover-preview": {
    maxWidth: "400px",
    maxHeight: "300px",
    overflow: "auto",
    padding: "8px 12px",
    fontSize: "0.9em",
    lineHeight: "1.5",
    fontFamily: monoFont,
  },
  ".cg-hover-preview-header": {
    fontWeight: "700",
    marginBottom: "4px",
    color: "var(--cg-fg)",
  },
  ".cg-hover-preview-body": {
    color: "var(--cg-muted)",
    whiteSpace: "pre-wrap",
  },
  ".cg-hover-preview-unresolved": {
    color: "var(--cg-muted)",
    fontStyle: "italic",
  },
  ".cg-hover-preview-citation": {
    color: "var(--cg-muted)",
    marginBottom: "4px",
  },
  ".cg-hover-preview-citation:last-child": {
    marginBottom: "0",
  },
};
