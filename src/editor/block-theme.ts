/**
 * Block and structural styles: fenced div headers/nesting, QED tombstone,
 * blockquotes, images, tables, and table toolbar.
 *
 * Per-block-type accent and body-style rules are auto-generated from
 * STYLED_BLOCK_NAMES (derived from BLOCK_MANIFEST in src/constants/).
 */

import { STYLED_BLOCK_NAMES } from "../constants/block-manifest";
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_PREVIEW_RESERVED_HEIGHT,
} from "../constants/layout";

/** Auto-generate per-block-type accent override rules from the manifest. */
function buildAccentRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  for (const name of STYLED_BLOCK_NAMES) {
    const selector = `.cf-block-${name} .cf-block-header, .cf-block-${name}.cf-block-header`;
    rules[selector] = { borderLeftColor: `var(--cf-block-${name}-accent)` };
  }
  return rules;
}

/** Auto-generate per-block-type body font-style rules from the manifest. */
function buildBodyStyleRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  for (const name of STYLED_BLOCK_NAMES) {
    rules[`.cf-block-${name}`] = { fontStyle: `var(--cf-block-${name}-style)` };
  }
  return rules;
}

export const blockThemeStyles: Record<string, Record<string, string>> = {
  /* Block header line — left border accent for fenced div blocks */
  ".cf-block-header": {
    borderLeft: "var(--cf-block-header-border-width) solid var(--cf-block-header-accent)",
  },

  /* Per-block-type accent overrides (auto-generated from BLOCK_MANIFEST) */
  ...buildAccentRules(),

  /* Block header: rendered widget label (e.g. "Theorem 1.").
   * lineHeight: 0 prevents the bold-serif content area from exceeding the
   * .cm-content strut (lineHeight: var(--cf-line-height)), eliminating the
   * 1px jitter when toggling between widget and source states (#776). */
  ".cf-block-header-rendered": {
    fontWeight: "var(--cf-block-title-weight)",
    color: "var(--cf-block-title-color)",
    lineHeight: "0",
  },
  ".cf-block-caption": {
    display: "block",
    marginTop: "var(--cf-spacing-xs)",
    textAlign: "center",
  },
  ".cf-block-caption .cf-block-header-rendered::after": {
    content: "var(--cf-block-title-separator)",
  },
  ".cf-block-proof .cf-block-header-rendered": {
    fontStyle: "italic",
    fontWeight: "400",
  },
  ".cf-block-proof .cf-block-header-rendered::after": {
    content: '". "',
  },

  /* Block title paren widgets — inserted via Decoration.widget, not CSS
   * pseudo-elements. CSS ::before/::after breaks when Decoration.replace
   * (math widgets) splits the mark, causing ") $x^2$" instead of "$x^2$)". */
  ".cf-block-title-paren": {
    userSelect: "none",
  },

  /* Attribute-only title widget — renders title from key-value attributes
   * (e.g. title="**3SUM**") when no inline title text exists. */
  ".cf-block-attr-title": {
    userSelect: "none",
  },

  /* Fenced div nesting guides — vertical lines on the left, editing only.
     Uses inset box-shadow so the guide never shifts content layout. */
  ".cf-fence-d1": {
    boxShadow: "inset var(--cf-fence-guide-width, 3px) 0 0 var(--cf-block-nest-1)",
  },
  ".cf-fence-d2": {
    boxShadow: "inset var(--cf-fence-guide-width, 3px) 0 0 var(--cf-block-nest-2)",
  },
  ".cf-fence-d3": {
    boxShadow: "inset var(--cf-fence-guide-width, 3px) 0 0 var(--cf-block-nest-3)",
  },
  ".cf-fence-d4": {
    boxShadow: "inset var(--cf-fence-guide-width, 3px) 0 0 var(--cf-block-nest-4)",
  },

  /* Per-block-type body font style (auto-generated from BLOCK_MANIFEST) */
  ...buildBodyStyleRules(),

  /* QED tombstone — right-aligned at end of proof blocks */
  ".cf-block-qed::after": {
    content: "var(--cf-proof-marker)",
    float: "right",
    color: "var(--cf-proof-marker-color)",
    fontSize: "var(--cf-proof-marker-size)",
    lineHeight: "1",
  },

  /* Blockquote plugin styling: fenced div blockquote blocks */
  ".cf-block-blockquote": {
    borderLeft: "var(--cf-border-width-accent) solid var(--cf-blockquote-border)",
    color: "var(--cf-blockquote-color)",
    paddingLeft: "1em",
    fontStyle: "italic",
  },

  /* Collapsed header: no visible label, zero height.
   * The block's own styling (border, padding) still applies to this line,
   * so the border start is visible even though content height is zero. */
  ".cf-block-header-collapsed": {
    height: "0",
    overflow: "hidden",
    padding: "0 !important",
    lineHeight: "0",
  },

  /* Closing fence line — always hidden in rich mode (zero height). */
  ".cf-block-closing-fence": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    padding: "0 !important",
    margin: "0",
  },

  /* Image preview — block widgets reserve the same async slot height that
   * ImagePreviewWidget reports to CM6's virtual height map. */
  ".cf-image-wrapper": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "100%",
  },
  ".cf-image-loading, .cf-image-placeholder": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: IMAGE_PREVIEW_RESERVED_HEIGHT,
    color: "var(--cf-muted)",
    fontSize: "0.85em",
    textAlign: "center",
  },
  ".cf-image": {
    display: "block",
    maxWidth: "100%",
    maxHeight: IMAGE_MAX_HEIGHT,
  },
  ".cf-block-figure .cf-image-wrapper": {
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    margin: "0 auto",
  },
  ".cf-image-error": {
    display: "inline-block",
    color: "var(--cf-fg)",
    fontStyle: "italic",
    fontSize: "0.85em",
    padding: "2px 6px",
    border: "var(--cf-border-width) solid var(--cf-fg)",
    borderRadius: "var(--cf-border-radius)",
    verticalAlign: "middle",
  },

  /* HTML table widget styles — shared visual contract for the same nested
   * inline CM6 surface in both preview and active states. Font size,
   * line height, and padding stay on the cell so focus/edit mode does not
   * perturb token geometry. */
  ".cf-table-widget": {
    margin: "var(--cf-spacing-sm) 0",
  },
  ".cf-block-table .cf-table-widget": {
    width: "fit-content",
    maxWidth: "100%",
    margin: "var(--cf-spacing-sm) auto",
  },

  ".cf-table-widget table": {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "var(--cf-table-font-size, 0.9em)",
  },
  ".cf-block-table .cf-table-widget table": {
    width: "auto",
    maxWidth: "100%",
  },

  ".cf-table-widget th, .cf-table-widget td": {
    border: "var(--cf-border-width) solid var(--cf-table-border)",
    padding: "var(--cf-table-cell-padding)",
    lineHeight: "var(--cf-table-line-height, 1.5)",
    textAlign: "left",
    verticalAlign: "top",
  },

  ".cf-table-widget th": {
    fontWeight: "700",
    borderBottom: "var(--cf-border-width-accent) solid var(--cf-table-header-border)",
  },

  /* Active cell editing indicator — inherits font-size / line-height / padding
   * from the cell so the inline CM6 editor matches the display rendering. */
  ".cf-table-cell-editing": {
    outline: "var(--cf-border-width-accent) solid var(--cf-table-edit-outline)",
    outlineOffset: "calc(-1 * var(--cf-border-width-accent))",
    backgroundColor: "transparent",
  },

  ".cf-table-cell-active": {
    outline: "var(--cf-border-width-accent) solid var(--cf-table-edit-outline)",
    outlineOffset: "calc(-1 * var(--cf-border-width-accent))",
    backgroundColor: "transparent",
  },

};
