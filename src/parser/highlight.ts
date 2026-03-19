import { tags } from "@lezer/highlight";
import type { InlineParser, MarkdownConfig, InlineContext } from "@lezer/markdown";
import { EQUALS, scanDoubleDelimited } from "./char-utils";

/**
 * Inline parser for ==highlight== syntax.
 * Detects == delimiters (char code 61) and produces Highlight nodes
 * with HighlightMark children for the opening and closing ==.
 */
const highlightParser: InlineParser = {
  name: "Highlight",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== EQUALS) return -1;

    const match = scanDoubleDelimited(cx, pos, EQUALS, false);
    if (!match) return -1;

    const openMark = cx.elt("HighlightMark", pos, pos + 2);
    const closeMark = cx.elt("HighlightMark", match.closeStart, match.closeEnd);
    return cx.addElement(
      cx.elt("Highlight", pos, match.closeEnd, [openMark, closeMark]),
    );
  },
  before: "Escape",
};

/** Markdown extension that adds ==highlight== syntax. */
export const highlightExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Highlight",
      style: tags.special(tags.content),
    },
    {
      name: "HighlightMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [highlightParser],
};
