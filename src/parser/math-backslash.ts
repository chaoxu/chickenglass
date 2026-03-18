import { tags } from "@lezer/highlight";
import type {
  BlockParser,
  InlineParser,
  MarkdownConfig,
  BlockContext,
  Line,
  InlineContext,
} from "@lezer/markdown";

const BACKSLASH = 92; // '\'
const OPEN_PAREN = 40; // '('
const CLOSE_PAREN = 41; // ')'
const DOLLAR = 36; // '$'

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
 * Block parser for \[...\] display math syntax.
 * Detects \[ at line start, scans for \] (potentially multi-line).
 * Produces DisplayMath nodes matching the same type as $$...$$ math.
 */
const backslashDisplayMathParser: BlockParser = {
  name: "BackslashDisplayMath",
  parse(cx: BlockContext, line: Line) {
    // Check that line starts with \[ (after indentation)
    const textAfterIndent = line.text.slice(line.pos - line.basePos);
    if (!textAfterIndent.startsWith("\\[")) return false;

    const start = cx.lineStart + line.pos;
    // Check if \] is on the same line
    const closeIdx = textAfterIndent.indexOf("\\]", 2);
    if (closeIdx >= 0) {
      // Single-line display math: \[...\]
      const end = cx.lineStart + line.pos + closeIdx + 2;
      const openMark = cx.elt("DisplayMathMark", start, start + 2);
      const closeMark = cx.elt("DisplayMathMark", end - 2, end);
      cx.addElement(cx.elt("DisplayMath", start, end, [openMark, closeMark]));
      cx.nextLine();
      return true;
    }

    // Multi-line: scan subsequent lines for \]
    let endPos = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      const closeInLine = currentText.indexOf("\\]");
      if (closeInLine >= 0) {
        endPos = cx.lineStart + closeInLine + 2;
        break;
      }
      currentLineEnd = cx.lineStart + currentText.length;
    }

    const foundClose = endPos >= 0;
    if (!foundClose) endPos = currentLineEnd;
    const openMark = cx.elt("DisplayMathMark", start, start + 2);
    const marks = foundClose
      ? [openMark, cx.elt("DisplayMathMark", endPos - 2, endPos)]
      : [openMark];
    cx.addElement(cx.elt("DisplayMath", start, endPos, marks));
    cx.nextLine();
    return true;
  },
  before: "HorizontalRule",
};

/**
 * Block parser for $$...$$ display math syntax.
 * Detects $$ at line start, scans for closing $$ (potentially multi-line).
 */
const dollarDisplayMathParser: BlockParser = {
  name: "DollarDisplayMath",
  parse(cx: BlockContext, line: Line) {
    const textAfterIndent = line.text.slice(line.pos - line.basePos);
    if (!textAfterIndent.startsWith("$$")) return false;

    const start = cx.lineStart + line.pos;

    // Check if closing $$ is on the same line (after the opening $$)
    const rest = textAfterIndent.slice(2);
    const closeIdx = rest.indexOf("$$");
    if (closeIdx >= 0) {
      const end = start + 2 + closeIdx + 2;
      const openMark = cx.elt("DisplayMathMark", start, start + 2);
      const closeMark = cx.elt("DisplayMathMark", end - 2, end);
      cx.addElement(cx.elt("DisplayMath", start, end, [openMark, closeMark]));
      cx.nextLine();
      return true;
    }

    // Multi-line: scan subsequent lines for $$
    let endPos = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      const trimmed = currentText.trimStart();
      if (trimmed.startsWith("$$")) {
        const leadingSpaces = currentText.length - trimmed.length;
        endPos = cx.lineStart + leadingSpaces + 2;
        break;
      }
      currentLineEnd = cx.lineStart + currentText.length;
    }

    const foundClose = endPos >= 0;
    if (!foundClose) endPos = currentLineEnd;
    const openMark = cx.elt("DisplayMathMark", start, start + 2);
    const marks = foundClose
      ? [openMark, cx.elt("DisplayMathMark", endPos - 2, endPos)]
      : [openMark];
    cx.addElement(cx.elt("DisplayMath", start, endPos, marks));
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
