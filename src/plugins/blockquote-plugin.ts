/**
 * Blockquote block plugin.
 *
 * Renders `::: Blockquote` or `::: {.blockquote}` as a styled block
 * with a left border, italic text, and muted color. Unnumbered.
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";

export const blockquotePlugin: BlockPlugin = createStandardPlugin({
  name: "blockquote",
  numbered: false,
});
