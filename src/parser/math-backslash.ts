import { tags } from "@lezer/highlight";
import type {
  InlineParser,
  MarkdownConfig,
  InlineContext,
} from "@lezer/markdown";
import {
  BACKSLASH,
  CLOSE_PAREN,
  DOLLAR,
  OPEN_PAREN,
} from "./char-utils";

/**
 * Inline parser for \(...\) math syntax.
 * Produces InlineMath nodes matching the same type as $...$ math.
 */
const backslashInlineMathParser: InlineParser = {
  name: "BackslashInlineMath",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== BACKSLASH) return -1;
    if (cx.char(pos + 1) !== OPEN_PAREN) return -1;

    // Scan forward for \)
    const start = pos;
    let i = pos + 2;
    while (i < cx.end) {
      const ch = cx.char(i);
      if (ch === BACKSLASH && cx.char(i + 1) === CLOSE_PAREN) {
        const openMark = cx.elt("InlineMathMark", start, start + 2);
        const closeMark = cx.elt("InlineMathMark", i, i + 2);
        return cx.addElement(
          cx.elt("InlineMath", start, i + 2, [openMark, closeMark]),
        );
      }
      i++;
    }

    return -1;
  },
  before: "Escape",
};

/**
 * Inline parser for $...$ math syntax.
 * Produces InlineMath nodes. Handles edge cases:
 * - $$ is not inline math (it starts display math)
 * - $ at end of inline section doesn't match
 */
const dollarInlineMathParser: InlineParser = {
  name: "DollarInlineMath",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== DOLLAR) return -1;
    // $$ is display math, not inline
    if (cx.char(pos + 1) === DOLLAR) return -1;

    // Scan forward for closing $
    let i = pos + 1;
    while (i < cx.end) {
      const ch = cx.char(i);
      if (ch === DOLLAR) {
        const openMark = cx.elt("InlineMathMark", pos, pos + 1);
        const closeMark = cx.elt("InlineMathMark", i, i + 1);
        return cx.addElement(
          cx.elt("InlineMath", pos, i + 1, [openMark, closeMark]),
        );
      }
      // Backslash escapes inside $ math: skip next char
      if (ch === BACKSLASH && i + 1 < cx.end) {
        i += 2;
        continue;
      }
      i++;
    }

    return -1;
  },
  before: "Escape",
};

/**
 * Markdown extension for inline math syntax (`$...$` and `\(...\)`) and
 * math node type definitions.
 *
 * Node definitions:
 * - `InlineMath` / `InlineMathMark` — inline math delimiters
 * - `DisplayMath` / `DisplayMathMark` — display math delimiters (defined here,
 *   but the block parsers that produce them live in `equation-label.ts`)
 *
 * Display-math block parsing (`$$...$$` and `\[...\]`) is handled entirely by
 * `equationLabelExtension` in `equation-label.ts`, which owns both plain
 * display math and labeled display math (`{#eq:...}`).
 */
export const mathExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "InlineMath",
      style: tags.special(tags.content),
    },
    {
      name: "InlineMathMark",
      style: tags.processingInstruction,
    },
    {
      name: "DisplayMath",
      style: tags.special(tags.content),
      block: true,
    },
    {
      name: "DisplayMathMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [backslashInlineMathParser, dollarInlineMathParser],
};
