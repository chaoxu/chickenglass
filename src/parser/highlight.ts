import { tags } from "@lezer/highlight";
import type { InlineParser, MarkdownConfig, InlineContext } from "@lezer/markdown";

const EQUALS = 61; // '='

/**
 * Inline parser for ==highlight== syntax.
 * Detects == delimiters (char code 61) and produces Highlight nodes
 * with HighlightMark children for the opening and closing ==.
 */
const highlightParser: InlineParser = {
  name: "Highlight",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== EQUALS) return -1;
    // Must be == (two equals signs)
    if (cx.char(pos + 1) !== EQUALS) return -1;

    // Scan forward for closing ==
    let i = pos + 2;
    while (i < cx.end) {
      const ch = cx.char(i);
      if (ch === EQUALS && cx.char(i + 1) === EQUALS) {
        const openMark = cx.elt("HighlightMark", pos, pos + 2);
        const closeMark = cx.elt("HighlightMark", i, i + 2);
        return cx.addElement(
          cx.elt("Highlight", pos, i + 2, [openMark, closeMark]),
        );
      }
      i++;
    }

    return -1;
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
