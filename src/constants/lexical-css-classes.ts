/**
 * CSS class names for Lexical node root elements.
 *
 * Single source of truth for the `cf-lexical-*` class names that appear on
 * both the Lexical node `createDOM()` output and the React renderer DOM.
 * Stylesheet selectors in `editor-theme.css` target the same strings.
 */

export const LEXICAL_NODE_CLASS = {
  INLINE_MATH: "cf-lexical-inline-math",
  INLINE_IMAGE: "cf-lexical-inline-image",
  FOOTNOTE_REFERENCE: "cf-lexical-footnote-ref",
  REFERENCE: "cf-lexical-reference",
  TABLE_BLOCK: "cf-lexical-table-block",
  TABLE_CELL: "cf-lexical-table-cell",
  TABLE_CELL_HEADER: "cf-lexical-table-cell--header",
} as const;
