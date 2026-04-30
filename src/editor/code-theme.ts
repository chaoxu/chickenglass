/**
 * Code block styles: container layout (header, body, last line),
 * copy button, source mode, and monochrome syntax highlighting tokens.
 *
 * These line classes must not change `.cm-line` font metrics, padding, or
 * border-box height. CM6 has one global height oracle; if a viewport full of
 * code lines changes that oracle, wrapped prose far away gets re-estimated and
 * scrolling jumps. Code-block chrome is therefore visual-only here.
 */
export const codeThemeStyles = {
  /* Code block: unified container via per-line classes.
     Header = top border + radius, body = side borders, last = bottom border + radius. */
  ".cf-codeblock-header": {
    position: "relative",
    backgroundColor: "var(--cf-subtle)",
    boxShadow:
      "inset 0 var(--cf-border-width) 0 var(--cf-border), inset var(--cf-border-width) 0 0 var(--cf-border), inset calc(-1 * var(--cf-border-width)) 0 0 var(--cf-border)",
    borderTopLeftRadius: "var(--cf-border-radius-lg)",
    borderTopRightRadius: "var(--cf-border-radius-lg)",
  },
  ".cf-codeblock-header-widget": {
    display: "inline",
  },
  ".cf-codeblock-language": {
    fontWeight: "600",
    color: "var(--cf-muted)",
    textTransform: "uppercase",
  },
  ".cf-codeblock-body": {
    backgroundColor: "var(--cf-subtle)",
    boxShadow:
      "inset var(--cf-border-width) 0 0 var(--cf-border), inset calc(-1 * var(--cf-border-width)) 0 0 var(--cf-border)",
  },
  ".cf-codeblock-last": {
    backgroundColor: "var(--cf-subtle)",
    boxShadow:
      "inset var(--cf-border-width) 0 0 var(--cf-border), inset calc(-1 * var(--cf-border-width)) 0 0 var(--cf-border), inset 0 calc(-1 * var(--cf-border-width)) 0 var(--cf-border)",
    borderBottomLeftRadius: "var(--cf-border-radius-lg)",
    borderBottomRightRadius: "var(--cf-border-radius-lg)",
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
    transition: "opacity var(--cf-transition, 0.15s ease)",
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
    backgroundColor: "var(--cf-subtle)",
  },
  ".cf-codeblock-source-open": {
    boxShadow:
      "inset 0 var(--cf-border-width) 0 var(--cf-border), inset var(--cf-border-width) 0 0 var(--cf-border), inset calc(-1 * var(--cf-border-width)) 0 0 var(--cf-border)",
    borderTopLeftRadius: "var(--cf-border-radius-lg)",
    borderTopRightRadius: "var(--cf-border-radius-lg)",
  },
  ".cf-codeblock-source-close": {
    boxShadow:
      "inset var(--cf-border-width) 0 0 var(--cf-border), inset calc(-1 * var(--cf-border-width)) 0 0 var(--cf-border), inset 0 calc(-1 * var(--cf-border-width)) 0 var(--cf-border)",
    borderBottomLeftRadius: "var(--cf-border-radius-lg)",
    borderBottomRightRadius: "var(--cf-border-radius-lg)",
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
