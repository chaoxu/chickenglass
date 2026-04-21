import { findTableCellSpans, scanTableInlineSpan } from "../../lib/table-inline-span";

export interface MarkdownTable {
  readonly alignments: ReadonlyArray<"center" | "left" | "right" | null>;
  readonly dividerCells?: ReadonlyArray<string>;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

function unescapeLiteralSeparatorPipes(markdown: string): string {
  let result = "";
  let index = 0;

  while (index < markdown.length) {
    if (markdown.startsWith("\\|", index)) {
      result += "|";
      index += 2;
      continue;
    }

    const spanEnd = scanTableInlineSpan(markdown, index);
    if (spanEnd !== null) {
      result += markdown.slice(index, spanEnd);
      index = spanEnd;
      continue;
    }

    result += markdown[index] ?? "";
    index += 1;
  }

  return result;
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const spans = findTableCellSpans(trimmed);
  if (spans.length === 0) {
    return [unescapeLiteralSeparatorPipes(trimmed)];
  }

  return spans.map((span) =>
    unescapeLiteralSeparatorPipes(trimmed.slice(span.from, span.to).trim())
  );
}

function parseAlignment(cell: string): "center" | "left" | "right" | null {
  const trimmed = cell.trim();
  const starts = trimmed.startsWith(":");
  const ends = trimmed.endsWith(":");
  if (starts && ends) {
    return "center";
  }
  if (starts) {
    return "left";
  }
  if (ends) {
    return "right";
  }
  return null;
}

function formatAlignment(align: "center" | "left" | "right" | null): string {
  if (align === "center") {
    return ":---:";
  }
  if (align === "left") {
    return ":---";
  }
  if (align === "right") {
    return "---:";
  }
  return "---";
}

function serializeTableCell(cell: string): string {
  let result = "";
  let index = 0;

  while (index < cell.length) {
    const spanEnd = scanTableInlineSpan(cell, index);
    if (spanEnd !== null) {
      result += cell.slice(index, spanEnd);
      index = spanEnd;
      continue;
    }

    const ch = cell[index] ?? "";
    result += ch === "|" ? "\\|" : ch;
    index += 1;
  }

  return result;
}

function serializeTableRow(cells: readonly string[]): string {
  return `| ${cells.map(serializeTableCell).join(" | ")} |`;
}

function serializeTableDivider(cells: readonly string[]): string {
  return `|${cells.join("|")}|`;
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

export function decodePipeTableCellMarkdown(markdown: string): string {
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

export function encodePipeTableCellMarkdown(markdown: string): string {
  return markdown
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("<br>");
}

export function parseMarkdownTable(raw: string): MarkdownTable | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return null;
  }

  const headers = splitTableCells(lines[0]);
  const divider = splitTableCells(lines[1]);
  if (headers.length === 0 || divider.length !== headers.length) {
    return null;
  }

  const alignments = divider.map(parseAlignment);
  const rows = lines.slice(2).map((line) => splitTableCells(line));

  return {
    alignments,
    dividerCells: divider,
    headers,
    rows: rows.map((row) => {
      const normalized = [...row];
      while (normalized.length < headers.length) {
        normalized.push("");
      }
      return normalized.slice(0, headers.length);
    }),
  };
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const columnCount = Math.max(
    1,
    table.headers.length,
    table.alignments.length,
    table.dividerCells?.length ?? 0,
    ...table.rows.map((row) => row.length),
  );
  const dividerCells = Array.from({ length: columnCount }, (_, index) =>
    table.dividerCells?.[index]?.trim() || formatAlignment(table.alignments[index] ?? null)
  );
  const headers = [...table.headers];
  while (headers.length < columnCount) {
    headers.push("");
  }
  const rows = table.rows.map((row) => {
    const normalized = [...row];
    while (normalized.length < columnCount) {
      normalized.push("");
    }
    return normalized.slice(0, columnCount);
  });

  return [
    serializeTableRow(headers.slice(0, columnCount)),
    serializeTableDivider(dividerCells),
    ...rows.map((row) => serializeTableRow(row)),
  ].join("\n");
}
