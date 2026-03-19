import { tags } from "@lezer/highlight";
import type { InlineParser, MarkdownConfig, InlineContext } from "@lezer/markdown";
import { TILDE, scanDoubleDelimited } from "./char-utils";

/**
 * Inline parser for ~~...~~ strikethrough syntax.
 * Produces 'Strikethrough' nodes with 'StrikethroughMark' children.
 */
const strikethroughParser: InlineParser = {
  name: "Strikethrough",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== TILDE) return -1;

    const match = scanDoubleDelimited(cx, pos, TILDE, true);
    if (!match) return -1;

    const openMark = cx.elt("StrikethroughMark", pos, pos + 2);
    const closeMark = cx.elt("StrikethroughMark", match.closeStart, match.closeEnd);
    return cx.addElement(
      cx.elt("Strikethrough", pos, match.closeEnd, [openMark, closeMark]),
    );
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
