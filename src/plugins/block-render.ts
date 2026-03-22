/**
 * Shared block rendering utilities.
 *
 * Provides a common render function used by all default block plugins.
 * Generates a BlockDecorationSpec with appropriate CSS class names
 * and a formatted header string.
 */

import type { BlockAttrs, BlockDecorationSpec } from "./plugin-types";
import { CSS } from "../constants/css-classes";

/**
 * Build a standard block header label string (widget text only).
 *
 * Format: "Title N" where N is optional.
 * Examples: "Theorem 1", "Proof", "Definition 3".
 *
 * NOTE: This does NOT include the user's title text (e.g., "(Main)").
 * Title text stays as editable document content where inline plugins
 * render math/bold/etc. See CLAUDE.md "Block headers must behave like headings."
 * The CSS separator (--cf-block-title-separator) is added via ::after.
 */
export function formatBlockHeader(
  displayTitle: string,
  attrs: BlockAttrs,
): string {
  if (attrs.number !== undefined) {
    return `${displayTitle} ${attrs.number}`;
  }
  return displayTitle;
}

/**
 * Create a standard render function for a block plugin.
 *
 * Returns a function that produces a BlockDecorationSpec with:
 * - className: custom or default "cf-block cf-block-{type}"
 * - header: formatted header string
 *
 * @param displayTitle - The title shown in the rendered header.
 * @param className - Optional custom className. If omitted, uses
 *   "cf-block cf-block-{type}" based on the block's type attribute.
 */
export function createBlockRender(displayTitle: string, className?: string) {
  return function render(attrs: BlockAttrs): BlockDecorationSpec {
    return {
      className: className ?? CSS.block(attrs.type),
      header: formatBlockHeader(displayTitle, attrs),
    };
  };
}
