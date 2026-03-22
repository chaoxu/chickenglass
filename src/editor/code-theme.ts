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
    fontSize: "0.85em",
    backgroundColor: "var(--cg-subtle)",
    borderTop: "1px solid var(--cg-border)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    padding: "0 12px",
    lineHeight: "inherit",
  },
  ".cg-codeblock-header-widget": {
    display: "inline",
  },
  ".cg-codeblock-language": {
    fontWeight: "600",
    color: "var(--cg-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: monoFont,
  },
  ".cg-codeblock-body": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cg-subtle)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cg-codeblock-last": {
    fontFamily: monoFont,
    fontSize: "0.85em",
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
    top: "50%",
    transform: "translateY(-50%)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    padding: "0",
    color: "var(--cg-muted)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "2px",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 0.15s",
  },
  ".cg-codeblock-copy svg": {
    width: "14px",
    height: "14px",
    display: "block",
  },
  ".cg-codeblock-header:hover .cg-codeblock-copy, .cg-codeblock-header.cg-codeblock-hovered .cg-codeblock-copy":
    {
    opacity: "1",
    },
  ".cg-codeblock-copy:hover": {
    color: "var(--cg-fg)",
  },

  /* Source mode: keep monospace font and subtle bg when cursor is inside */
  ".cg-codeblock-source": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cg-subtle)",
  },
  ".cg-codeblock-source-open": {
    borderTop: "1px solid var(--cg-border)",
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    lineHeight: "inherit",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cg-codeblock-source-close": {
    borderLeft: "1px solid var(--cg-border)",
    borderRight: "1px solid var(--cg-border)",
    borderBottom: "1px solid var(--cg-border)",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    lineHeight: "inherit",
    paddingLeft: "12px",
    paddingRight: "12px",
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
