import { monoFont } from "./editor-constants";

/**
 * Code block styles: container layout (header, body, last line),
 * copy button, source mode, and monochrome syntax highlighting tokens.
 */
export const codeThemeStyles = {
  /* Code block: unified container via per-line classes.
     Header = top border + radius, body = side borders, last = bottom border + radius. */
  ".cf-codeblock-header": {
    position: "relative",
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
    borderTop: "1px solid var(--cf-border)",
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    padding: "0 12px",
    lineHeight: "inherit",
  },
  ".cf-codeblock-header-widget": {
    display: "inline",
  },
  ".cf-codeblock-language": {
    fontWeight: "600",
    color: "var(--cf-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: monoFont,
  },
  ".cf-codeblock-body": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cf-codeblock-last": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    borderBottom: "1px solid var(--cf-border)",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    paddingLeft: "12px",
    paddingRight: "12px",
    paddingBottom: "4px",
  },

  /* Copy button in code block header */
  ".cf-codeblock-copy": {
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
    color: "var(--cf-muted)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "2px",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 0.15s",
  },
  ".cf-codeblock-copy svg": {
    width: "14px",
    height: "14px",
    display: "block",
  },
  ".cf-codeblock-header:hover .cf-codeblock-copy, .cf-codeblock-header.cf-codeblock-hovered .cf-codeblock-copy":
    {
    opacity: "1",
    },
  ".cf-codeblock-copy:hover": {
    color: "var(--cf-fg)",
  },

  /* Source mode: keep monospace font and subtle bg when cursor is inside */
  ".cf-codeblock-source": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
  },
  ".cf-codeblock-source-open": {
    borderTop: "1px solid var(--cf-border)",
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    lineHeight: "inherit",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cf-codeblock-source-close": {
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    borderBottom: "1px solid var(--cf-border)",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    lineHeight: "inherit",
    paddingLeft: "12px",
    paddingRight: "12px",
  },

  /* ── B&W syntax highlighting ─────────────────────────────────
     Monochrome theme: bold for keywords, italic for comments/strings,
     no color — just font-weight and font-style variation. */
  ".cf-codeblock-body .tok-keyword, .cf-codeblock-last .tok-keyword": {
    fontWeight: "700",
  },
  ".cf-codeblock-body .tok-controlKeyword, .cf-codeblock-last .tok-controlKeyword":
    {
      fontWeight: "700",
    },
  ".cf-codeblock-body .tok-definitionKeyword, .cf-codeblock-last .tok-definitionKeyword":
    {
      fontWeight: "700",
    },
  ".cf-codeblock-body .tok-operatorKeyword, .cf-codeblock-last .tok-operatorKeyword":
    {
      fontWeight: "700",
    },
  ".cf-codeblock-body .tok-modifier, .cf-codeblock-last .tok-modifier": {
    fontWeight: "700",
  },
  ".cf-codeblock-body .tok-comment, .cf-codeblock-last .tok-comment": {
    fontStyle: "italic",
    color: "var(--cf-muted)",
  },
  ".cf-codeblock-body .tok-string, .cf-codeblock-last .tok-string": {
    fontStyle: "italic",
  },
  ".cf-codeblock-body .tok-typeName, .cf-codeblock-last .tok-typeName": {
    textDecoration: "underline",
    textDecorationColor: "var(--cf-border)",
    textUnderlineOffset: "2px",
  },
  ".cf-codeblock-body .tok-number, .cf-codeblock-last .tok-number": {
    fontWeight: "500",
  },
  ".cf-codeblock-body .tok-bool, .cf-codeblock-last .tok-bool": {
    fontWeight: "700",
  },
};
