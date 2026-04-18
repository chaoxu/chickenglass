/**
 * table-lexical — Lexical-node-aware table markdown wiring.
 *
 * Pure parse/serialize helpers live in ./table-markdown (shared with the
 * renderer). This file owns the bridge between those helpers and the
 * Lexical node graph: reading/writing cell content through the markdown
 * transformer pipeline, building TableNode subtrees from a parsed table,
 * and exposing the MultilineElementTransformer used by coflat's markdown
 * converter.
 *
 * Kept separate from markdown.ts so that mid-file table-specific logic
 * isn't tangled with the other transformers. See #112.
 */
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type MultilineElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import { $createParagraphNode } from "lexical";

import {
  $createTableCellNode,
  $isTableCellNode,
  TableCellNode,
} from "../nodes/table-cell-node";
import {
  $createTableNode,
  $isTableNode,
  type TableColumnAlignment,
  TableNode,
} from "../nodes/table-node";
import {
  $createTableRowNode,
  $isTableRowNode,
  TableRowNode,
} from "../nodes/table-row-node";
import {
  type MarkdownTable,
  parseMarkdownTable,
  serializeMarkdownTable,
} from "./table-markdown";
import { matchTableEndLine } from "./block-scanner";

function normalizeTableAlignments(
  alignments: readonly TableColumnAlignment[],
  columnCount: number,
): TableColumnAlignment[] {
  const next = [...alignments.slice(0, columnCount)];
  while (next.length < columnCount) {
    next.push(null);
  }
  return next;
}

function writeTableCellMarkdown(
  cellNode: TableCellNode,
  markdown: string,
  cellTransformers: readonly Transformer[],
): void {
  $convertFromMarkdownString(
    decodeTableCellLineBreaks(markdown),
    [...cellTransformers],
    cellNode,
    true,
  );
  if (cellNode.getChildrenSize() === 0) {
    cellNode.append($createParagraphNode());
  }
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function backtickRunLength(text: string, index: number): number {
  let cursor = index;
  while (text[cursor] === "`") {
    cursor++;
  }
  return cursor - index;
}

function htmlBreakLength(text: string, index: number): number {
  return /^<br\s*\/?>/i.exec(text.slice(index))?.[0].length ?? 0;
}

function decodeTableCellLineBreaks(markdown: string): string {
  let result = "";
  let index = 0;
  let codeTickLength = 0;
  let mathDelimiter: "$" | "\\(" | null = null;

  while (index < markdown.length) {
    if (markdown[index] === "`") {
      const runLength = backtickRunLength(markdown, index);
      if (codeTickLength === 0) {
        codeTickLength = runLength;
      } else if (runLength === codeTickLength) {
        codeTickLength = 0;
      }
      result += markdown.slice(index, index + runLength);
      index += runLength;
      continue;
    }

    if (codeTickLength === 0) {
      if (mathDelimiter === "\\(") {
        if (markdown.startsWith("\\)", index) && !isEscaped(markdown, index)) {
          mathDelimiter = null;
          result += "\\)";
          index += 2;
          continue;
        }
      } else if (mathDelimiter === "$") {
        if (markdown[index] === "$" && !isEscaped(markdown, index)) {
          mathDelimiter = null;
        }
      } else if (markdown.startsWith("\\(", index) && !isEscaped(markdown, index)) {
        mathDelimiter = "\\(";
        result += "\\(";
        index += 2;
        continue;
      } else if (markdown[index] === "$" && !isEscaped(markdown, index)) {
        mathDelimiter = "$";
      }

      if (mathDelimiter === null) {
        const breakLength = htmlBreakLength(markdown, index);
        if (breakLength > 0) {
          result += "  \n";
          index += breakLength;
          continue;
        }
      }
    }

    result += markdown[index];
    index++;
  }

  return result;
}

function readTableCellMarkdown(
  cellNode: TableCellNode,
  cellTransformers: readonly Transformer[],
): string {
  return normalizePipeTableCellMarkdown(
    $convertToMarkdownString([...cellTransformers], cellNode, true),
  );
}

function normalizePipeTableCellMarkdown(markdown: string): string {
  return markdown
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("<br>");
}

function readTableRowMarkdown(
  rowNode: TableRowNode,
  columnCount: number,
  cellTransformers: readonly Transformer[],
): string[] {
  const cells = rowNode
    .getChildren()
    .filter($isTableCellNode)
    .slice(0, columnCount)
    .map((cellNode) => readTableCellMarkdown(cellNode, cellTransformers));
  while (cells.length < columnCount) {
    cells.push("");
  }
  return cells;
}

function buildTableNode(
  table: MarkdownTable,
  cellTransformers: readonly Transformer[],
): TableNode {
  const tableNode = $createTableNode(table.alignments, table.dividerCells ?? []);
  const headerRow = $createTableRowNode();
  for (const headerCell of table.headers) {
    const cellNode = $createTableCellNode(true);
    writeTableCellMarkdown(cellNode, headerCell, cellTransformers);
    headerRow.append(cellNode);
  }
  tableNode.append(headerRow);

  for (const row of table.rows) {
    const rowNode = $createTableRowNode();
    for (const cell of row) {
      const cellNode = $createTableCellNode(false);
      writeTableCellMarkdown(cellNode, cell, cellTransformers);
      rowNode.append(cellNode);
    }
    tableNode.append(rowNode);
  }

  return tableNode;
}

function extractMarkdownTable(
  node: TableNode,
  cellTransformers: readonly Transformer[],
): MarkdownTable {
  const rowNodes = node.getChildren().filter($isTableRowNode);
  const columnCount = Math.max(
    1,
    node.getAlignments().length,
    ...rowNodes.map((rowNode) =>
      rowNode.getChildren().filter($isTableCellNode).length
    ),
  );
  const headerRow = rowNodes[0] ?? null;

  return {
    alignments: normalizeTableAlignments(node.getAlignments(), columnCount),
    dividerCells: node.getDividerCells(),
    headers: headerRow
      ? readTableRowMarkdown(headerRow, columnCount, cellTransformers)
      : Array(columnCount).fill(""),
    rows: rowNodes
      .slice(headerRow ? 1 : 0)
      .map((rowNode) => readTableRowMarkdown(rowNode, columnCount, cellTransformers)),
  };
}

/**
 * Build a TableNode subtree from a raw markdown table block.  Parsing failure
 * returns null so callers can fall back to raw text.
 */
export function createTableNodeFromMarkdown(
  raw: string,
  cellTransformers: readonly Transformer[],
): TableNode | null {
  const parsed = parseMarkdownTable(raw);
  return parsed ? buildTableNode(parsed, cellTransformers) : null;
}

/**
 * Build the MultilineElementTransformer that coflat's markdown converter uses
 * for `|…|` blocks.  `cellTransformers` must contain the inline transformers
 * used inside cell content (text formats, inline math, images, references).
 * `joinLines` is the project-wide helper for concatenating raw lines.
 */
export function createTableBlockTransformer(
  cellTransformers: readonly Transformer[],
  joinLines: (
    lines: readonly string[],
    startLineIndex: number,
    endLineIndex: number,
  ) => string,
): MultilineElementTransformer {
  return {
    dependencies: [TableNode, TableRowNode, TableCellNode],
    export(node) {
      if ($isTableNode(node)) {
        return serializeMarkdownTable(extractMarkdownTable(node, cellTransformers));
      }
      return null;
    },
    handleImportAfterStartMatch({
      lines,
      rootNode,
      startLineIndex,
    }) {
      const endLineIndex = matchTableEndLine(lines, startLineIndex);
      if (endLineIndex < 0) {
        return null;
      }
      const tableNode = createTableNodeFromMarkdown(
        joinLines(lines, startLineIndex, endLineIndex),
        cellTransformers,
      );
      if (!tableNode) {
        return null;
      }
      rootNode.append(tableNode);
      return [true, endLineIndex];
    },
    regExpStart: /^\s*\|.*$/,
    replace(rootNode, _children, startMatch, endMatch, linesInBetween) {
      const fragments = [startMatch[0]];
      if (linesInBetween) {
        fragments.push(...linesInBetween);
      }
      if (endMatch && endMatch[0] !== startMatch[0]) {
        fragments.push(endMatch[0]);
      }
      const tableNode = createTableNodeFromMarkdown(
        fragments.join("\n"),
        cellTransformers,
      );
      if (!tableNode) {
        return false;
      }
      rootNode.append(tableNode);
      return true;
    },
    type: "multiline-element",
  };
}
