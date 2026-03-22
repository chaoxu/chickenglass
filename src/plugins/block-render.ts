/**
 * Shared block rendering utilities.
 *
 * Provides a common render function used by all default block plugins.
 * Generates a BlockDecorationSpec with appropriate CSS class names
 * and a formatted header string.
 */

import type { BlockAttrs, BlockDecorationSpec } from "./plugin-types";

/**
 * Build a standard block header string.
 *
 * Format: "Title N (User Title)" where N and user title are optional.
 * Examples: "Theorem 1", "Theorem 1 (Main)", "Proof", "Proof (of Theorem 1)".
 */
export function formatBlockHeader(
  displayTitle: string,
  attrs: BlockAttrs,
): string {
  const parts = [displayTitle];
  if (attrs.number !== undefined) {
    parts.push(` ${attrs.number}`);
  }
  if (attrs.title) {
    parts.push(` (${attrs.title})`);
  }
  return parts.join("");
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
      className: className ?? `cf-block cf-block-${attrs.type}`,
      header: formatBlockHeader(displayTitle, attrs),
    };
  };
}
