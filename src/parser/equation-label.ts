import { tags } from "@lezer/highlight";
import type {
  BlockParser,
  MarkdownConfig,
  BlockContext,
  Line,
  Element,
} from "@lezer/markdown";
import { OPEN_BRACE, CLOSE_BRACE, skipSpaceTab } from "./char-utils";
import { isClosingFence } from "./fenced-div";
import { parseBracedId } from "./label-utils";

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
  if (!parseBracedId(text.slice(braceStart, braceEnd), "eq:")) return undefined;

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

/** Result of scanning subsequent lines for a closing display-math delimiter. */
interface MultilineScanResult {
  found: boolean;
  endPos: number;
  closingLineText: string;
  closingLineStart: number;
}

/**
 * Scan subsequent lines for a closing display-math delimiter (`$$` or `\]`).
 * Stops at fenced div closing fences to avoid crossing composite boundaries.
 */
function scanMultilineClose(
  cx: BlockContext,
  line: Line,
  closeDelimiter: string,
): MultilineScanResult {
  const closeLen = closeDelimiter.length;
  let currentLineEnd = cx.lineStart + line.text.length;
  while (cx.nextLine()) {
    const currentText = line.text;
    // Stop at fenced div closing fences — update currentLineEnd BEFORE
    // breaking so the unclosed math block ends at the previous line,
    // not at a stale position from an earlier iteration.
    if (isClosingFence(currentText, line.pos) >= 3) {
      currentLineEnd = cx.lineStart;
      break;
    }
    const closeInLine = currentText.indexOf(closeDelimiter);
    if (closeInLine >= 0) {
      return {
        found: true,
        endPos: cx.lineStart + closeInLine + closeLen,
        closingLineText: currentText,
        closingLineStart: cx.lineStart,
      };
    }
    currentLineEnd = cx.lineStart + currentText.length;
  }
  return { found: false, endPos: currentLineEnd, closingLineText: "", closingLineStart: -1 };
}

/**
 * Create a block parser for display math with optional equation labels.
 * Detects the open delimiter at line start, scans for the close delimiter
 * (potentially multi-line), then checks for a trailing {#eq:...} label.
 */
function makeDisplayMathParser(
  name: string,
  openDelimiter: string,
  closeDelimiter: string,
): BlockParser {
  const openLen = openDelimiter.length;
  const closeLen = closeDelimiter.length;

  return {
    name,
    endLeaf(_cx: BlockContext, line: Line): boolean {
      return line.text.slice(line.pos).startsWith(openDelimiter);
    },
    parse(cx: BlockContext, line: Line) {
      const textAfterIndent = line.text.slice(line.pos);
      if (!textAfterIndent.startsWith(openDelimiter)) return false;

      const start = cx.lineStart + line.pos;

      // Single-line: open...close possibly followed by {#eq:...}
      const closeIdx = textAfterIndent.indexOf(closeDelimiter, openLen);
      if (closeIdx >= 0) {
        const closeEnd = closeIdx + closeLen;
        const end = start + closeEnd;
        const openMark = cx.elt("DisplayMathMark", start, start + openLen);
        const closeMark = cx.elt("DisplayMathMark", end - closeLen, end);
        const children = [openMark, closeMark];
        const blockEnd = appendLabelIfPresent(
          cx, children, textAfterIndent, start, closeEnd, end,
        );
        cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
        cx.nextLine();
        return true;
      }

      // Multi-line: scan subsequent lines for closing delimiter
      const scan = scanMultilineClose(cx, line, closeDelimiter);

      const openMark = cx.elt("DisplayMathMark", start, start + openLen);
      const children = scan.found
        ? [openMark, cx.elt("DisplayMathMark", scan.endPos - closeLen, scan.endPos)]
        : [openMark];

      const blockEnd = scan.found
        ? appendLabelIfPresent(
            cx, children, scan.closingLineText, scan.closingLineStart,
            scan.endPos - scan.closingLineStart, scan.endPos,
          )
        : scan.endPos;

      cx.addElement(cx.elt("DisplayMath", start, blockEnd, children));
      cx.nextLine();
      return true;
    },
    before: "HorizontalRule",
  };
}

/**
 * Canonical block parsers for ALL display math (`$$...$$` and `\[...\]`).
 *
 * Both plain display math and labeled display math (`{#eq:...}`) are handled
 * here. Use alongside `mathExtension` (from `math-backslash.ts`), which
 * provides the node type definitions and inline math parsers.
 *
 * Supported syntax:
 *   $$ x^2 $$
 *   \[ x^2 \]
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
  parseBlock: [
    makeDisplayMathParser("BackslashDisplayMath", "\\[", "\\]"),
    makeDisplayMathParser("DollarDisplayMath", "$$", "$$"),
  ],
};
