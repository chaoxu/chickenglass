import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Markdown extension that removes blockquote (`>`) parsing.
 *
 * Standard markdown `>` blockquotes are replaced by fenced div
 * blockquotes (`::: Blockquote` / `::: {.blockquote}`) which provide
 * better composability with other fenced div features (math, nested
 * blocks, etc.).
 */
export const removeBlockquote: MarkdownConfig = {
  remove: ["Blockquote"],
};
