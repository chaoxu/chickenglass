import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Markdown extension that removes indented code block parsing.
 *
 * In standard CommonMark, 4 spaces or a tab at the start of a line
 * creates a code block. This is undesirable for mathematical writing
 * where indentation is used freely (e.g. inside fenced divs or list
 * continuations). Removing IndentedCode ensures such text is treated
 * as regular paragraph content.
 */
export const removeIndentedCode: MarkdownConfig = {
  remove: ["IndentedCode"],
};
