import { tags } from "@lezer/highlight";
import type {
  BlockParser,
  MarkdownConfig,
  BlockContext,
  Line,
  Element,
} from "@lezer/markdown";
import type { Input } from "@lezer/common";
import { OPEN_BRACE, CLOSE_BRACE, skipSpaceTab } from "./char-utils";
import { isClosingFenceLine } from "./fenced-div";
import { parseBracedId } from "./label-utils";

interface BlockContextWithInput extends BlockContext {
  readonly input: Input;
}

type ClosingSuffix =
  | { readonly kind: "valid"; readonly labelFrom?: number; readonly labelTo?: number }
  | { readonly kind: "invalid" };

function isAllowedTrailingPunctuation(text: string): boolean {
  return /^[.,;]\s*$/.test(text);
}

/**
 * Try to extract an equation label from text following a closing math delimiter.
 * Returns label positions (relative to the line), an empty valid suffix, or invalid
 * when non-whitespace text follows the closing delimiter.
 */
function parseClosingSuffix(
  text: string,
  startOffset: number,
): ClosingSuffix {
  let i = skipSpaceTab(text, startOffset);
  if (i >= text.length) return { kind: "valid" };
  if (text.charCodeAt(i) !== OPEN_BRACE) {
    return isAllowedTrailingPunctuation(text.slice(i))
      ? { kind: "valid" }
      : { kind: "invalid" };
  }

  const braceStart = i;
  i++;
  while (i < text.length && text.charCodeAt(i) !== CLOSE_BRACE) {
    i++;
  }
  if (i >= text.length) return { kind: "invalid" };

  const braceEnd = i + 1;
  if (!parseBracedId(text.slice(braceStart, braceEnd), "eq:")) {
    return { kind: "invalid" };
  }

  // Ensure nothing meaningful follows the label
  if (text.slice(braceEnd).trim().length > 0) return { kind: "invalid" };

  return { kind: "valid", labelFrom: braceStart, labelTo: braceEnd };
}

// Bound the lookahead so a stray `$$` near the start of a very large doc
// cannot force the parser to read the entire suffix. Real display-math blocks
// are well under this budget; beyond it we conclude "unclosed" and let the
// surrounding parser handle the opener as plain text.
const CLOSE_LOOKAHEAD_BUDGET = 64 * 1024;
const CLOSE_LOOKAHEAD_READ_CHUNK = 1024;

interface LookaheadLine {
  readonly text: string;
  readonly nextLineStart: number;
}

function readLookaheadLine(
  input: Input,
  lineStart: number,
  budgetEnd: number,
): LookaheadLine | null {
  if (lineStart >= budgetEnd) return null;

  let cursor = lineStart;
  let text = "";
  while (cursor < budgetEnd) {
    const chunkEnd = Math.min(cursor + CLOSE_LOOKAHEAD_READ_CHUNK, budgetEnd);
    const chunk = input.read(cursor, chunkEnd);
    if (chunk.length === 0) return null;

    const newlineOffset = chunk.indexOf("\n");
    if (newlineOffset >= 0) {
      return {
        text: text + chunk.slice(0, newlineOffset),
        nextLineStart: cursor + newlineOffset + 1,
      };
    }

    text += chunk;
    cursor = chunkEnd;
  }

  return {
    text,
    nextLineStart: budgetEnd,
  };
}

function validateClosingDelimiterLookahead(
  cx: BlockContext,
  line: Line,
  openDelimiter: string,
  closeDelimiter: string,
): "valid" | "invalid" | "unclosed" {
  const input = (cx as BlockContextWithInput).input;
  const budgetEnd = Math.min(input.length, cx.lineStart + CLOSE_LOOKAHEAD_BUDGET);
  let lineText = line.text;
  let nextLineStart = cx.lineStart + line.text.length + 1;
  let firstLine = true;

  for (;;) {
    if (!firstLine && isClosingFenceLine(lineText) >= 3) {
      return "unclosed";
    }

    const searchFrom = firstLine ? line.pos + openDelimiter.length : 0;
    const closeInLine = lineText.indexOf(closeDelimiter, searchFrom);
    if (closeInLine >= 0) {
      const suffix = parseClosingSuffix(
        lineText,
        closeInLine + closeDelimiter.length,
      );
      return suffix.kind;
    }

    const nextLine = readLookaheadLine(input, nextLineStart, budgetEnd);
    if (nextLine === null) break;
    if (nextLine.nextLineStart === nextLineStart && nextLine.text.length === 0) {
      break;
    }
    lineText = nextLine.text;
    nextLineStart = nextLine.nextLineStart;
    firstLine = false;
  }

  return "unclosed";
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
  const label = parseClosingSuffix(lineText, closeOffset);
  if (
    label.kind !== "valid"
    || label.labelFrom === undefined
    || label.labelTo === undefined
  ) {
    return closeAbsEnd;
  }
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
  stoppedBeforeFence: boolean;
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
  while (true) {
    const nextLine = cx.peekLine() as string | null;
    if (nextLine !== null && isClosingFenceLine(nextLine) >= 3) {
      return {
        found: false,
        endPos: currentLineEnd,
        closingLineText: "",
        closingLineStart: -1,
        stoppedBeforeFence: true,
      };
    }

    if (!cx.nextLine()) {
      return {
        found: false,
        endPos: currentLineEnd,
        closingLineText: "",
        closingLineStart: -1,
        stoppedBeforeFence: false,
      };
    }

    const currentText = line.text;
    const closeInLine = currentText.indexOf(closeDelimiter);
    if (closeInLine >= 0) {
      return {
        found: true,
        endPos: cx.lineStart + closeInLine + closeLen,
        closingLineText: currentText,
        closingLineStart: cx.lineStart,
        stoppedBeforeFence: false,
      };
    }
    currentLineEnd = cx.lineStart + currentText.length;
  }
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
      const closeValidation = validateClosingDelimiterLookahead(
        cx,
        line,
        openDelimiter,
        closeDelimiter,
      );
      if (closeValidation === "invalid") return false;

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
      if (textAfterIndent.slice(openLen).trim().length > 0) return false;

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
      if (scan.stoppedBeforeFence) {
        cx.nextLine();
        return true;
      }
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
