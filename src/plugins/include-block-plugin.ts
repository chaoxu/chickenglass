/**
 * Block plugin for rendering `::: {.include} path.md` blocks.
 *
 * Displays a file label header (e.g., "📄 chapter1.md") with the
 * included content editable below it. Not numbered.
 */

import type { BlockPlugin, BlockAttrs, BlockDecorationSpec } from "./plugin-types";

/** Block plugin for include blocks. */
export const includePlugin: BlockPlugin = {
  name: "include",
  title: "Include",
  numbered: false,
  render(attrs: BlockAttrs): BlockDecorationSpec {
    const path = attrs.title ?? "unknown";
    return {
      className: "cg-block cg-block-include",
      header: `\u{1F4C4} ${path}`,
    };
  },
};
