import { tags } from "@lezer/highlight";
import type { InlineParser, MarkdownConfig, InlineContext } from "@lezer/markdown";

const TILDE = 126; // '~'

/**
 * Inline parser for ~~...~~ strikethrough syntax.
 * Produces 'Strikethrough' nodes with 'StrikethroughMark' children.
 */
const strikethroughParser: InlineParser = {
  name: "Strikethrough",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== TILDE) return -1;
    // Require exactly ~~ (not ~~~+)
    if (cx.char(pos + 1) !== TILDE) return -1;
    if (cx.char(pos + 2) === TILDE) return -1;

    // Scan forward for closing ~~
    let i = pos + 2;
    while (i < cx.end) {
      const ch = cx.char(i);
      if (ch === TILDE && cx.char(i + 1) === TILDE && cx.char(i + 2) !== TILDE) {
        const openMark = cx.elt("StrikethroughMark", pos, pos + 2);
        const closeMark = cx.elt("StrikethroughMark", i, i + 2);
        return cx.addElement(
          cx.elt("Strikethrough", pos, i + 2, [openMark, closeMark]),
        );
      }
      i++;
    }

    return -1;
  },
  before: "Escape",
};

/** Markdown extension that adds ~~strikethrough~~ syntax. */
export const strikethroughExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Strikethrough",
      style: tags.strikethrough,
    },
    {
      name: "StrikethroughMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [strikethroughParser],
};
