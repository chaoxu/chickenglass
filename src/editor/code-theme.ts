import { monoFont } from "./editor-constants";

/**
 * Code block styles: container layout (header, body, last line),
 * copy button, source mode, and monochrome syntax highlighting tokens.
 */
export const codeThemeStyles = {
  /* Code block: unified container via per-line classes.
     Header = top border + radius, body = side borders, last = bottom border + radius. */
  ".cg-codeblock-header": {
    position: "relative",
    fontFamily: monoFont,
    backgroundColor: "var(--cg-subtle)",
    borderTop: "1px solid var(--cg-border)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    padding: "4px 12px 0 12px",
    fontSize: "0.75em",
    lineHeight: "2",
  },
  ".cg-codeblock-header[data-language]::before": {
    content: "attr(data-language)",
    fontWeight: "600",
    color: "var(--cg-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: monoFont,
  },
  ".cg-codeblock-body": {
    fontFamily: monoFont,
    backgroundColor: "var(--cg-subtle)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cg-codeblock-last": {
    fontFamily: monoFont,
    backgroundColor: "var(--cg-subtle)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    borderBottom: "1px solid var(--cg-border)",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    paddingLeft: "12px",
    paddingRight: "12px",
    paddingBottom: "4px",
  },

  /* Copy button in code block header */
  ".cg-codeblock-copy": {
    position: "absolute",
    right: "8px",
    top: "4px",
    padding: "2px 6px",
    fontSize: "11px",
    color: "var(--cg-muted)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "2px",
    cursor: "pointer",
    fontFamily: monoFont,
    opacity: "0",
    transition: "opacity 0.15s",
  },
  ".cg-codeblock-header:hover .cg-codeblock-copy": {
    opacity: "1",
  },
  ".cg-codeblock-copy:hover": {
    color: "var(--cg-fg)",
    borderColor: "var(--cg-border)",
  },

  /* Source mode: subtle indication that fences are visible */
  ".cg-codeblock-source": {
    backgroundColor: "var(--cg-subtle)",
  },

  /* ── B&W syntax highlighting ─────────────────────────────────
     Monochrome theme: bold for keywords, italic for comments/strings,
     no color — just font-weight and font-style variation. */
  ".cg-codeblock-body .tok-keyword, .cg-codeblock-last .tok-keyword": {
    fontWeight: "700",
  },
  ".cg-codeblock-body .tok-controlKeyword, .cg-codeblock-last .tok-controlKeyword":
    {
      fontWeight: "700",
    },
  ".cg-codeblock-body .tok-definitionKeyword, .cg-codeblock-last .tok-definitionKeyword":
    {
      fontWeight: "700",
    },
  ".cg-codeblock-body .tok-operatorKeyword, .cg-codeblock-last .tok-operatorKeyword":
    {
      fontWeight: "700",
    },
  ".cg-codeblock-body .tok-modifier, .cg-codeblock-last .tok-modifier": {
    fontWeight: "700",
  },
  ".cg-codeblock-body .tok-comment, .cg-codeblock-last .tok-comment": {
    fontStyle: "italic",
    color: "var(--cg-muted)",
  },
  ".cg-codeblock-body .tok-string, .cg-codeblock-last .tok-string": {
    fontStyle: "italic",
  },
  ".cg-codeblock-body .tok-typeName, .cg-codeblock-last .tok-typeName": {
    textDecoration: "underline",
    textDecorationColor: "var(--cg-border)",
    textUnderlineOffset: "2px",
  },
  ".cg-codeblock-body .tok-number, .cg-codeblock-last .tok-number": {
    fontWeight: "500",
  },
  ".cg-codeblock-body .tok-bool, .cg-codeblock-last .tok-bool": {
    fontWeight: "700",
  },
};
