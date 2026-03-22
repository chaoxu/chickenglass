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
    borderTop: "var(--cf-border-width) solid var(--cf-border)",
    borderLeft: "var(--cf-border-width) solid var(--cf-border)",
    borderRight: "var(--cf-border-width) solid var(--cf-border)",
    borderTopLeftRadius: "var(--cf-border-radius-lg)",
    borderTopRightRadius: "var(--cf-border-radius-lg)",
    padding: "0 var(--cf-spacing-md)",
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
    borderLeft: "var(--cf-border-width) solid var(--cf-border)",
    borderRight: "var(--cf-border-width) solid var(--cf-border)",
    paddingLeft: "var(--cf-spacing-md)",
    paddingRight: "var(--cf-spacing-md)",
  },
  ".cf-codeblock-last": {
    fontFamily: monoFont,
    fontSize: "0.85em",
    backgroundColor: "var(--cf-subtle)",
    borderLeft: "var(--cf-border-width) solid var(--cf-border)",
    borderRight: "var(--cf-border-width) solid var(--cf-border)",
    borderBottom: "var(--cf-border-width) solid var(--cf-border)",
    borderBottomLeftRadius: "var(--cf-border-radius-lg)",
    borderBottomRightRadius: "var(--cf-border-radius-lg)",
    paddingLeft: "var(--cf-spacing-md)",
    paddingRight: "var(--cf-spacing-md)",
    paddingBottom: "var(--cf-spacing-xs)",
  },

  /* Copy button in code block header */
  ".cf-codeblock-copy": {
    position: "absolute",
    right: "var(--cf-spacing-sm)",
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
    border: "var(--cf-border-width) solid transparent",
    borderRadius: "var(--cf-border-radius)",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 0.15s",
  },
  ".cf-codeblock-copy svg": {
    width: "var(--cf-ui-font-size-base)",
    height: "var(--cf-ui-font-size-base)",
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
    borderTop: "var(--cf-border-width) solid var(--cf-border)",
    borderLeft: "var(--cf-border-width) solid var(--cf-border)",
    borderRight: "var(--cf-border-width) solid var(--cf-border)",
    borderTopLeftRadius: "var(--cf-border-radius-lg)",
    borderTopRightRadius: "var(--cf-border-radius-lg)",
    lineHeight: "inherit",
    paddingLeft: "var(--cf-spacing-md)",
    paddingRight: "var(--cf-spacing-md)",
  },
  ".cf-codeblock-source-close": {
    borderLeft: "var(--cf-border-width) solid var(--cf-border)",
    borderRight: "var(--cf-border-width) solid var(--cf-border)",
    borderBottom: "var(--cf-border-width) solid var(--cf-border)",
    borderBottomLeftRadius: "var(--cf-border-radius-lg)",
    borderBottomRightRadius: "var(--cf-border-radius-lg)",
    lineHeight: "inherit",
    paddingLeft: "var(--cf-spacing-md)",
    paddingRight: "var(--cf-spacing-md)",
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
