/**
 * Block and structural styles: fenced div headers/nesting, QED tombstone,
 * blockquotes, images, tables, table toolbar, embeds, and include regions.
 */
export const blockThemeStyles = {
  /* Block header line — left border accent for fenced div blocks */
  ".cf-block-header": {
    borderLeft: "var(--cf-block-header-border-width) solid var(--cf-block-header-accent)",
    paddingLeft: "var(--cf-block-header-padding)",
  },

  /* Per-block-type accent overrides (borderLeftColor only) */
  ".cf-block-theorem .cf-block-header, .cf-block-theorem.cf-block-header": {
    borderLeftColor: "var(--cf-block-theorem-accent)",
  },
  ".cf-block-lemma .cf-block-header, .cf-block-lemma.cf-block-header": {
    borderLeftColor: "var(--cf-block-lemma-accent)",
  },
  ".cf-block-corollary .cf-block-header, .cf-block-corollary.cf-block-header": {
    borderLeftColor: "var(--cf-block-corollary-accent)",
  },
  ".cf-block-proposition .cf-block-header, .cf-block-proposition.cf-block-header": {
    borderLeftColor: "var(--cf-block-proposition-accent)",
  },
  ".cf-block-conjecture .cf-block-header, .cf-block-conjecture.cf-block-header": {
    borderLeftColor: "var(--cf-block-conjecture-accent)",
  },
  ".cf-block-definition .cf-block-header, .cf-block-definition.cf-block-header": {
    borderLeftColor: "var(--cf-block-definition-accent)",
  },
  ".cf-block-problem .cf-block-header, .cf-block-problem.cf-block-header": {
    borderLeftColor: "var(--cf-block-problem-accent)",
  },
  ".cf-block-example .cf-block-header, .cf-block-example.cf-block-header": {
    borderLeftColor: "var(--cf-block-example-accent)",
  },
  ".cf-block-remark .cf-block-header, .cf-block-remark.cf-block-header": {
    borderLeftColor: "var(--cf-block-remark-accent)",
  },
  ".cf-block-proof .cf-block-header, .cf-block-proof.cf-block-header": {
    borderLeftColor: "var(--cf-block-proof-accent)",
  },
  ".cf-block-algorithm .cf-block-header, .cf-block-algorithm.cf-block-header": {
    borderLeftColor: "var(--cf-block-algorithm-accent)",
  },

  /* Block header: rendered widget label (e.g. "Theorem 1.") */
  ".cf-block-header-rendered": {
    fontWeight: "var(--cf-block-title-weight)",
    color: "var(--cf-block-title-color)",
  },

  /* Fenced div nesting guides — vertical lines on the left, editing only.
     Uses inset box-shadow so the guide never shifts content layout. */
  ".cf-fence-d1": {
    boxShadow: "inset 3px 0 0 var(--cf-block-nest-1)",
  },
  ".cf-fence-d2": {
    boxShadow: "inset 3px 0 0 var(--cf-block-nest-2)",
  },
  ".cf-fence-d3": {
    boxShadow: "inset 3px 0 0 var(--cf-block-nest-3)",
  },
  ".cf-fence-d4": {
    boxShadow: "inset 3px 0 0 var(--cf-block-nest-4)",
  },

  /* Theorem-family: italic body (academic convention, matches Read mode) */
  ".cf-block-theorem, .cf-block-lemma, .cf-block-corollary, .cf-block-proposition, .cf-block-conjecture": {
    fontStyle: "var(--cf-block-theorem-style)",
  },
  /* Definition, problem, proof, remark: normal body */
  ".cf-block-definition, .cf-block-problem, .cf-block-proof, .cf-block-remark, .cf-block-example, .cf-block-algorithm": {
    fontStyle: "var(--cf-block-body-style)",
  },

  /* QED tombstone — right-aligned at end of proof blocks */
  ".cf-block-qed::after": {
    content: "var(--cf-proof-marker)",
    float: "right",
    color: "var(--cf-proof-marker-color)",
    fontSize: "var(--cf-proof-marker-size)",
    lineHeight: "1",
  },

  /* Include fence lines — collapsed to zero height for seamless flow */
  ".cf-include-fence": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Include block styling */
  ".cf-block-include": {
    borderLeft: "2px solid var(--cf-include-accent)",
    paddingLeft: "1em",
    marginBottom: "0.5em",
  },

  /* Blockquote plugin styling: fenced div blockquote blocks */
  ".cf-block-blockquote": {
    borderLeft: "2px solid var(--cf-blockquote-border)",
    color: "var(--cf-blockquote-color)",
    paddingLeft: "1em",
    fontStyle: "italic",
  },

  /* Hide header widget for blockquotes — no "Blockquote" label */
  ".cf-block-blockquote .cf-block-header-rendered": {
    display: "none",
  },

  /* Inline image preview */
  ".cf-image-wrapper": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "100%",
  },
  ".cf-image": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "400px",
  },
  ".cf-image-error": {
    display: "inline-block",
    color: "var(--cf-fg)",
    fontStyle: "italic",
    fontSize: "0.85em",
    padding: "2px 6px",
    border: "1px solid var(--cf-fg)",
    borderRadius: "2px",
    verticalAlign: "middle",
  },

  /* HTML table widget styles */
  ".cf-table-widget": {
    margin: "8px 0",
  },

  ".cf-table-widget table": {
    borderCollapse: "collapse",
    width: "100%",
  },

  ".cf-table-widget th, .cf-table-widget td": {
    border: "1px solid var(--cf-table-border)",
    padding: "var(--cf-table-cell-padding)",
    textAlign: "left",
    verticalAlign: "top",
  },

  ".cf-table-widget th": {
    fontWeight: "700",
    borderBottom: "2px solid var(--cf-table-header-border)",
  },

  /* Active cell editing indicator */
  ".cf-table-cell-editing": {
    outline: "2px solid var(--cf-table-edit-outline)",
    outlineOffset: "-2px",
    backgroundColor: "transparent",
  },

  /* Embed block: iframe container */
  ".cf-embed": {
    display: "block",
    width: "100%",
    margin: "4px 0",
  },
  ".cf-embed-iframe": {
    display: "block",
    width: "100%",
    height: "350px",
    border: "1px solid var(--cf-embed-border)",
    borderRadius: "2px",
    backgroundColor: "transparent",
  },
  /* YouTube: responsive 16:9 aspect ratio */
  ".cf-embed-youtube": {
    position: "relative",
    width: "100%",
    paddingBottom: "56.25%",
    height: "0",
    margin: "4px 0",
  },
  ".cf-embed-youtube-iframe": {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    border: "1px solid var(--cf-embed-border)",
    borderRadius: "2px",
  },
  /* Gist embed: auto-size to content instead of fixed height */
  ".cf-embed-gist .cf-embed-iframe": {
    height: "auto",
    minHeight: "200px",
  },

  /* Include region: right border spans the full height, label anchors to it */
  ".cf-include-region": {
    position: "relative",
    borderRight: "1px solid var(--cf-include-accent)",
  },

  /* Include label: rotated filename inside the right padding of .cm-content */
  ".cf-include-label": {
    position: "absolute",
    right: "-44px",
    top: "2px",
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    userSelect: "none",
    pointerEvents: "none",
    fontSize: "10px",
    color: "var(--cf-include-label-color)",
    whiteSpace: "nowrap",
    letterSpacing: "0.3px",
    lineHeight: "1",
    zIndex: "1",
  },

  ".cf-include-label-active": {
    color: "var(--cf-include-label-active-color)",
  },
};
