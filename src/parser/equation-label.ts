import { tags } from "@lezer/highlight";
import type {
  BlockParser,
  MarkdownConfig,
  BlockContext,
  Line,
  Element,
} from "@lezer/markdown";
import { OPEN_BRACE, CLOSE_BRACE, skipSpaceTab } from "./char-utils";

/** Regex to validate that a braced string is an equation label: {#eq:...} */
const LABEL_RE = /^\{#eq:[^}\s]+\}$/;

/**
 * Try to extract an equation label from text following a closing math delimiter.
 * Returns brace positions (relative to the line) or undefined if no label is found.
 */
function extractLabel(
  text: string,
  startOffset: number,
): { labelFrom: number; labelTo: number } | undefined {
  let i = skipSpaceTab(text, startOffset);
  if (i >= text.length || text.charCodeAt(i) !== OPEN_BRACE) return undefined;

  const braceStart = i;
  i++;
  while (i < text.length && text.charCodeAt(i) !== CLOSE_BRACE) {
    i++;
  }
  if (i >= text.length) return undefined;

  const braceEnd = i + 1;
  if (!LABEL_RE.test(text.slice(braceStart, braceEnd))) return undefined;

  // Ensure nothing meaningful follows the label
  if (text.slice(braceEnd).trim().length > 0) return undefined;

  return { labelFrom: braceStart, labelTo: braceEnd };
}

/**
 * Given a closing delimiter position and line context, check for a trailing
 * equation label and append it to the children array. Returns the final
 * block end position (extended past the label if one was found).
 */
function appendLabelIfPresent(
  cx: BlockContext,
  children: Element[],
  lineText: string,
  lineStart: number,
  closeOffset: number,
  closeAbsEnd: number,
): number {
  const label = extractLabel(lineText, closeOffset);
  if (!label) return closeAbsEnd;
  const labelFrom = lineStart + label.labelFrom;
  const labelTo = lineStart + label.labelTo;
  children.push(cx.elt("EquationLabel", labelFrom, labelTo));
  return labelTo;
}

/**
 * Block parser for \[...\] display math with optional equation labels.
 * Detects \[ at line start, scans for \] (potentially multi-line),
 * then checks for a trailing {#eq:...} label.
 */
const backslashDisplayMathWithLabel: BlockParser = {
  name: "BackslashDisplayMath",
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return line.text.slice(line.pos).startsWith("\\[");
  },
  parse(cx: BlockContext, line: Line) {
    const textAfterIndent = line.text.slice(line.pos);
    if (!textAfterIndent.startsWith("\\[")) return false;

    const start = cx.lineStart + line.pos;

    // Single-line: \[...\] possibly followed by {#eq:...}
    const closeIdx = textAfterIndent.indexOf("\\]", 2);
    if (closeIdx >= 0) {
      const end = start + closeIdx + 2;
      const openMark = cx.elt("DisplayMathMark", start, start + 2);
      const closeMark = cx.elt("DisplayMathMark", end - 2, end);
      const children = [openMark, closeMark];
      const blockEnd = appendLabelIfPresent(
        cx, children, textAfterIndent, start, closeIdx + 2, end,
      );
      cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
      cx.nextLine();
      return true;
    }

    // Multi-line: scan subsequent lines for \]
    let endPos = -1;
    let closingLineText = "";
    let closingLineStart = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      const closeInLine = currentText.indexOf("\\]");
      if (closeInLine >= 0) {
        endPos = cx.lineStart + closeInLine + 2;
        closingLineText = currentText;
        closingLineStart = cx.lineStart;
        break;
      }
      currentLineEnd = cx.lineStart + currentText.length;
    }

    const foundClose = endPos >= 0;
    if (!foundClose) endPos = currentLineEnd;

    const openMark = cx.elt("DisplayMathMark", start, start + 2);
    const children = foundClose
      ? [openMark, cx.elt("DisplayMathMark", endPos - 2, endPos)]
      : [openMark];

    const blockEnd = foundClose
      ? appendLabelIfPresent(
          cx, children, closingLineText, closingLineStart,
          endPos - closingLineStart, endPos,
        )
      : endPos;

    cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
    cx.nextLine();
    return true;
  },
  before: "HorizontalRule",
};

/**
 * Block parser for $$...$$ display math with optional equation labels.
 * Detects $$ at line start, scans for closing $$ (potentially multi-line),
 * then checks for a trailing {#eq:...} label.
 */
const dollarDisplayMathWithLabel: BlockParser = {
  name: "DollarDisplayMath",
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return line.text.slice(line.pos).startsWith("$$");
  },
  parse(cx: BlockContext, line: Line) {
    const textAfterIndent = line.text.slice(line.pos);
    if (!textAfterIndent.startsWith("$$")) return false;

    const start = cx.lineStart + line.pos;

    // Single-line: $$...$$ possibly followed by {#eq:...}
    const rest = textAfterIndent.slice(2);
    const closeIdx = rest.indexOf("$$");
    if (closeIdx >= 0) {
      const closeEnd = 2 + closeIdx + 2;
      const end = start + closeEnd;
      const openMark = cx.elt("DisplayMathMark", start, start + 2);
      const closeMark = cx.elt("DisplayMathMark", end - 2, end);
      const children = [openMark, closeMark];
      const blockEnd = appendLabelIfPresent(
        cx, children, textAfterIndent, start, closeEnd, end,
      );
      cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
      cx.nextLine();
      return true;
    }

    // Multi-line: scan subsequent lines for closing $$
    // The closing $$ can be at the start of a line (standalone $$)
    // or at the end of a line (e.g., \end{aligned}$$)
    let endPos = -1;
    let closingLineText = "";
    let closingLineStart = -1;
    let currentLineEnd = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const currentText = line.text;
      const trimmed = currentText.trimStart();
      if (trimmed.startsWith("$$")) {
        // $$ at start of line
        const leadingSpaces = currentText.length - trimmed.length;
        endPos = cx.lineStart + leadingSpaces + 2;
        closingLineText = currentText;
        closingLineStart = cx.lineStart;
        break;
      }
      const trimmedEnd = currentText.trimEnd();
      if (trimmedEnd.endsWith("$$")) {
        // $$ at end of line (e.g., \end{aligned}$$)
        endPos = cx.lineStart + trimmedEnd.length;
        closingLineText = currentText;
        closingLineStart = cx.lineStart;
        break;
      }
      currentLineEnd = cx.lineStart + currentText.length;
    }

    const foundClose = endPos >= 0;
    if (!foundClose) endPos = currentLineEnd;

    const openMark = cx.elt("DisplayMathMark", start, start + 2);
    const children = foundClose
      ? [openMark, cx.elt("DisplayMathMark", endPos - 2, endPos)]
      : [openMark];

    const blockEnd = foundClose
      ? appendLabelIfPresent(
          cx, children, closingLineText, closingLineStart,
          endPos - closingLineStart, endPos,
        )
      : endPos;

    cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
    cx.nextLine();
    return true;
  },
  before: "HorizontalRule",
};

/**
 * Markdown extension that adds equation label support to display math blocks.
 *
 * This extension replaces the display math block parsers from `mathExtension`
 * with versions that detect trailing `{#eq:...}` labels. It must be used
 * alongside `mathExtension` (which it overrides by parser name).
 *
 * Supported syntax:
 *   $$ x^2 $$ {#eq:quadratic}
 *   \[ x^2 \] {#eq:quadratic}
 *   $$
 *   x^2
 *   $$ {#eq:quadratic}
 */
export const equationLabelExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "EquationLabel",
      style: tags.labelName,
    },
  ],
  parseBlock: [backslashDisplayMathWithLabel, dollarDisplayMathWithLabel],
};
