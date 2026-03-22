import { tags } from "@lezer/highlight";
import type {
  BlockContext,
  BlockParser,
  InlineParser,
  Line,
  MarkdownConfig,
  InlineContext,
} from "@lezer/markdown";
import {
  BACKSLASH,
  CLOSE_PAREN,
  COLON,
  DOLLAR,
  OPEN_PAREN,
  skipSpaceTab,
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

function isFencedDivClose(text: string, pos: number): boolean {
  let count = 0;
  while (pos + count < text.length && text.charCodeAt(pos + count) === COLON) count++;
  if (count < 3) return false;
  const afterColons = skipSpaceTab(text, pos + count);
  return afterColons >= text.length;
}

function addDisplayMathElement(
  cx: BlockContext,
  start: number,
  end: number,
): void {
  const openMark = cx.elt("DisplayMathMark", start, start + 2);
  const closeMark = cx.elt("DisplayMathMark", end - 2, end);
  cx.addElement(cx.elt("DisplayMath", start, end, [openMark, closeMark]));
}

function addUnclosedDisplayMathElement(
  cx: BlockContext,
  start: number,
  end: number,
): void {
  const openMark = cx.elt("DisplayMathMark", start, start + 2);
  cx.addElement(cx.elt("DisplayMath", start, end, [openMark]));
}

const backslashDisplayMathParser: BlockParser = {
  name: "BackslashDisplayMath",
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return line.text.slice(line.pos).startsWith("\\[");
  },
  parse(cx: BlockContext, line: Line) {
    const textAfterIndent = line.text.slice(line.pos);
    if (!textAfterIndent.startsWith("\\[")) return false;

    const start = cx.lineStart + line.pos;
    const closeIdx = textAfterIndent.indexOf("\\]", 2);
    if (closeIdx >= 0) {
      addDisplayMathElement(cx, start, start + closeIdx + 2);
      cx.nextLine();
      return true;
    }

    let endPos = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      if (isFencedDivClose(currentText, line.pos)) break;
      const closeInLine = currentText.indexOf("\\]");
      if (closeInLine >= 0) {
        endPos = cx.lineStart + closeInLine + 2;
        break;
      }
      currentLineEnd = cx.lineStart + currentText.length;
    }

    if (endPos >= 0) {
      addDisplayMathElement(cx, start, endPos);
    } else {
      addUnclosedDisplayMathElement(cx, start, currentLineEnd);
    }
    cx.nextLine();
    return true;
  },
  before: "HorizontalRule",
};

const dollarDisplayMathParser: BlockParser = {
  name: "DollarDisplayMath",
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return line.text.slice(line.pos).startsWith("$$");
  },
  parse(cx: BlockContext, line: Line) {
    const textAfterIndent = line.text.slice(line.pos);
    if (!textAfterIndent.startsWith("$$")) return false;

    const start = cx.lineStart + line.pos;
    const rest = textAfterIndent.slice(2);
    const closeIdx = rest.indexOf("$$");
    if (closeIdx >= 0) {
      addDisplayMathElement(cx, start, start + 2 + closeIdx + 2);
      cx.nextLine();
      return true;
    }

    let endPos = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      if (isFencedDivClose(currentText, line.pos)) break;

      const trimmedStart = currentText.trimStart();
      if (trimmedStart.startsWith("$$")) {
        const leadingSpaces = currentText.length - trimmedStart.length;
        endPos = cx.lineStart + leadingSpaces + 2;
        break;
      }

      const trimmedEnd = currentText.trimEnd();
      if (trimmedEnd.endsWith("$$")) {
        endPos = cx.lineStart + trimmedEnd.length;
        break;
      }

      currentLineEnd = cx.lineStart + currentText.length;
    }

    if (endPos >= 0) {
      addDisplayMathElement(cx, start, endPos);
    } else {
      addUnclosedDisplayMathElement(cx, start, currentLineEnd);
    }
    cx.nextLine();
    return true;
  },
  before: "HorizontalRule",
};

/** Markdown extension that adds math syntax for both $ and backslash variants. */
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
  parseBlock: [backslashDisplayMathParser, dollarDisplayMathParser],
};
