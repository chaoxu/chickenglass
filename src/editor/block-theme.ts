/**
 * Block and structural styles: fenced div headers/nesting, QED tombstone,
 * blockquotes, images, tables, table toolbar, embeds, and include regions.
 */
export const blockThemeStyles = {
  /* Block header line — left border accent for fenced div blocks */
  ".cg-block-header": {
    borderLeft: "2px solid var(--cg-fg)",
    paddingLeft: "12px",
  },

  /* Block header: rendered widget label (e.g. "Theorem 1.") */
  ".cg-block-header-rendered": {
    fontWeight: "700",
    color: "var(--cg-fg)",
  },

  /* Fenced div nesting guides — vertical lines on the left, editing only.
     Uses inset box-shadow so the guide never shifts content layout. */
  ".cg-fence-d1": {
    boxShadow: "inset 3px 0 0 var(--cg-border)",
  },
  ".cg-fence-d2": {
    boxShadow: "inset 3px 0 0 var(--cg-active)",
  },
  ".cg-fence-d3": {
    boxShadow: "inset 3px 0 0 var(--cg-muted)",
  },
  ".cg-fence-d4": {
    boxShadow: "inset 3px 0 0 var(--cg-fg)",
  },

  /* QED tombstone — right-aligned at end of proof blocks */
  ".cg-block-qed::after": {
    content: "'\\220E'",
    float: "right",
    fontSize: "1.2em",
    lineHeight: "1",
  },

  /* Include fence lines — collapsed to zero height for seamless flow */
  ".cg-include-fence": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Include block styling */
  ".cg-block-include": {
    borderLeft: "2px solid var(--cg-border)",
    paddingLeft: "1em",
    marginBottom: "0.5em",
  },

  /* Blockquote styling: applied to .cm-line elements via Decoration.line */
  ".cg-blockquote": {
    borderLeft: "2px solid var(--cg-border)",
    paddingLeft: "1em",
    color: "var(--cg-muted)",
    fontStyle: "italic",
  },

  /* Inline image preview */
  ".cg-image-wrapper": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "100%",
  },
  ".cg-image": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "400px",
  },
  ".cg-image-error": {
    display: "inline-block",
    color: "var(--cg-fg)",
    fontStyle: "italic",
    fontSize: "0.85em",
    padding: "2px 6px",
    border: "1px solid var(--cg-fg)",
    borderRadius: "2px",
    verticalAlign: "middle",
  },

  /* HTML table widget styles */
  ".cg-table-widget": {
    margin: "8px 0",
  },

  ".cg-table-widget table": {
    borderCollapse: "collapse",
    width: "100%",
  },

  ".cg-table-widget th, .cg-table-widget td": {
    border: "1px solid var(--cg-border)",
    padding: "4px 8px",
    textAlign: "left",
    verticalAlign: "top",
  },

  ".cg-table-widget th": {
    fontWeight: "700",
    borderBottom: "2px solid var(--cg-border)",
  },

  /* Active cell editing indicator */
  ".cg-table-cell-editing": {
    outline: "2px solid var(--cg-active)",
    outlineOffset: "-2px",
    backgroundColor: "transparent",
  },

  /* Embed block: iframe container */
  ".cg-embed": {
    display: "block",
    width: "100%",
    margin: "4px 0",
  },
  ".cg-embed-iframe": {
    display: "block",
    width: "100%",
    height: "350px",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
    backgroundColor: "transparent",
  },
  /* YouTube: responsive 16:9 aspect ratio */
  ".cg-embed-youtube": {
    position: "relative",
    width: "100%",
    paddingBottom: "56.25%",
    height: "0",
    margin: "4px 0",
  },
  ".cg-embed-youtube-iframe": {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    border: "1px solid var(--cg-border)",
    borderRadius: "2px",
  },
  /* Gist embed: auto-size to content instead of fixed height */
  ".cg-embed-gist .cg-embed-iframe": {
    height: "auto",
    minHeight: "200px",
  },

  /* Include region: right border spans the full height, label anchors to it */
  ".cg-include-region": {
    position: "relative",
    borderRight: "1px solid var(--cg-border)",
  },

  /* Include label: rotated filename inside the right padding of .cm-content */
  ".cg-include-label": {
    position: "absolute",
    right: "-44px",
    top: "2px",
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    userSelect: "none",
    pointerEvents: "none",
    fontSize: "10px",
    color: "var(--cg-border)",
    whiteSpace: "nowrap",
    letterSpacing: "0.3px",
    lineHeight: "1",
    zIndex: "1",
  },

  ".cg-include-label-active": {
    color: "var(--cg-muted)",
  },
};
