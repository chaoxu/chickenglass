/**
 * Span-aware GFM table block parser.
 *
 * Replaces the built-in @lezer/markdown Table extension. The only difference
 * from the upstream implementation is parseRow(): before treating '|' as a
 * column separator, the scanner first tries to consume recognised inline spans
 * at the current position (escaped char, \(...\), $...$, `...`).
 * Pipes inside those spans are invisible to the column splitter.
 *
 * This is Pandoc's approach (the `chunk` combinator in pipeTableRow): the
 * block-level row parser must be span-aware because Lezer's inline parsers
 * run *after* block structure is established, so InlineMath nodes for math
 * containing '|' would never exist in the tree if the block parser splits
 * those rows first.
 */

import {
  BlockContext,
  Element,
  LeafBlock,
  type LeafBlockParser,
  Line,
  type MarkdownConfig,
} from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import { BACKSLASH, COLON, DASH, PIPE, SPACE, TAB } from "./char-utils";
import { scanTableInlineSpan } from "../lib/table-inline-span";

/**
 * Parse a table row, returning the cell count.
 *
 * When `elts` is provided, TableCell and TableDelimiter elements are pushed
 * onto it. `offset` is the document-absolute position of `line[0]`.
 *
 * Spans handled (pipes inside are not treated as column separators):
 *   \X        escaped character
 *   \(...\)   backslash-paren inline math (with `\|` for literal pipes)
 *   $...$     single-dollar inline math
 *   `...`     backtick code span (any run length)
 */
function parseRow(
  cx: BlockContext,
  line: string,
  startI = 0,
  elts?: Element[],
  offset = 0,
): number {
  let count = 0,
    first = true,
    cellStart = -1,
    cellEnd = -1;

  const parseCell = (target: Element[]) => {
    target.push(
      cx.elt(
        "TableCell",
        offset + cellStart,
        offset + cellEnd,
        cx.parser.parseInline(
          line.slice(cellStart, cellEnd),
          offset + cellStart,
        ),
      ),
    );
  };

  /** Update cell content extent with a non-whitespace range [from, to). */
  const markNonWS = (from: number, to: number) => {
    if (cellStart < 0) cellStart = from;
    cellEnd = to;
  };

  let i = startI;
  while (i < line.length) {
    const spanEnd = scanTableInlineSpan(line, i);
    if (spanEnd !== null) {
      markNonWS(i, spanEnd);
      i = spanEnd;
    } else if (line.charCodeAt(i) === PIPE) {
      if (!first || cellStart > -1) count++;
      first = false;
      if (elts) {
        if (cellStart > -1) parseCell(elts);
        elts.push(cx.elt("TableDelimiter", i + offset, i + offset + 1));
      }
      cellStart = cellEnd = -1;
      i++;
    } else if (line.charCodeAt(i) !== SPACE && line.charCodeAt(i) !== TAB) {
      markNonWS(i, i + 1);
      i++;
    } else {
      i++;
    }
  }

  if (cellStart > -1) {
    count++;
    if (elts) parseCell(elts);
  }

  return count;
}

/** Quick pre-check: does the string contain any unescaped pipe character? */
function hasPipe(str: string, start: number): boolean {
  for (let i = start; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === PIPE) return true;
    if (ch === BACKSLASH) i++;
  }
  return false;
}

const delimiterLine = /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?)?$/;

function isDelimiterLine(text: string): boolean {
  return delimiterLine.test(text);
}

class TableParser implements LeafBlockParser {
  // null  = haven't seen the second line yet
  // false = not a table
  // array = table in progress; accumulated rows
  rows: false | null | Element[] = null;

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (this.rows == null) {
      // Second line — check if it's a valid delimiter row
      this.rows = false;
      let lineText: string;
      if (
        (line.next === DASH || line.next === COLON || line.next === PIPE) &&
        isDelimiterLine((lineText = line.text.slice(line.pos)))
      ) {
        const firstRow: Element[] = [];
        parseRow(cx, leaf.content, 0, firstRow, leaf.start);
        const delimiterCount = parseRow(cx, lineText, line.pos);
        if (delimiterCount > 0) {
          this.rows = [
            cx.elt(
              "TableHeader",
              leaf.start,
              leaf.start + leaf.content.length,
              firstRow,
            ),
            cx.elt(
              "TableDelimiter",
              cx.lineStart + line.pos,
              cx.lineStart + line.text.length,
            ),
          ];
        }
      }
    } else if (this.rows) {
      // Data row
      const content: Element[] = [];
      parseRow(cx, line.text, line.pos, content, cx.lineStart);
      this.rows.push(
        cx.elt(
          "TableRow",
          cx.lineStart + line.pos,
          cx.lineStart + line.text.length,
          content,
        ),
      );
    }
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.rows) return false;
    cx.addLeafElement(
      leaf,
      cx.elt(
        "Table",
        leaf.start,
        leaf.start + leaf.content.length,
        this.rows as readonly Element[],
      ),
    );
    return true;
  }
}

/**
 * Span-aware GFM table extension.
 *
 * Drop-in replacement for the `Table` export from `@lezer/markdown`.
 * Uses the same node names (Table, TableHeader, TableRow, TableCell,
 * TableDelimiter) so all downstream consumers work without changes.
 */
export const tableExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Table", block: true },
    { name: "TableHeader", style: { "TableHeader/...": t.heading } },
    "TableRow",
    { name: "TableCell", style: t.content },
    { name: "TableDelimiter", style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: "Table",
      leaf(_, leaf) {
        return hasPipe(leaf.content, 0) ? new TableParser() : null;
      },
      endLeaf(cx, line, leaf) {
        if (
          leaf.parsers.some((p) => p instanceof TableParser) ||
          !hasPipe(line.text, line.basePos)
        )
          return false;
        const next = cx.peekLine();
        return (
          isDelimiterLine(next) &&
          parseRow(cx, next, line.basePos) > 0
        );
      },
      before: "SetextHeading",
    },
  ],
};
