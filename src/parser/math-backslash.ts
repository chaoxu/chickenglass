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
import {
  isPandocDollarMathCloser,
  isPandocDollarMathOpener,
} from "../lib/pandoc-dollar-math";

function addInlineMathElement(
  cx: InlineContext,
  openStart: number,
  openEnd: number,
  closeStart: number,
  closeEnd: number,
): number {
  const openMark = cx.elt("InlineMathMark", openStart, openEnd);
  const closeMark = cx.elt("InlineMathMark", closeStart, closeEnd);
  return cx.addElement(
    cx.elt("InlineMath", openStart, closeEnd, [openMark, closeMark]),
  );
}

function isEscapedByBackslash(cx: InlineContext, pos: number): boolean {
  let slashCount = 0;
  for (let cursor = pos - 1; cursor >= 0; cursor -= 1) {
    if (cx.char(cursor) !== BACKSLASH) break;
    slashCount++;
  }
  return slashCount % 2 === 1;
}

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
        return addInlineMathElement(cx, start, start + 2, i, i + 2);
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
    if (isEscapedByBackslash(cx, pos)) return -1;
    if (!isPandocDollarMathOpener(cx.char(pos + 1))) return -1;

    // Scan forward for closing $
    let i = pos + 1;
    while (i < cx.end) {
      const ch = cx.char(i);
      if (
        ch === DOLLAR
        && isPandocDollarMathCloser(cx.char(i - 1), cx.char(i + 1))
      ) {
        return addInlineMathElement(cx, pos, pos + 1, i, i + 1);
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
