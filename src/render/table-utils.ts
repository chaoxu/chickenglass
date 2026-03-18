/**
 * Table data model and manipulation utilities.
 *
 * Works with GFM-style pipe tables:
 *   | Header | Header |
 *   | ------ | ------ |
 *   | Cell   | Cell   |
 */

/** Column alignment as detected from the separator row. */
export type Alignment = "left" | "center" | "right" | "none";

/** A parsed table cell. */
export interface TableCell {
  /** Trimmed cell content (may contain inline markdown). */
  readonly content: string;
}

/** A parsed table row. */
export interface TableRow {
  readonly cells: readonly TableCell[];
}

/** A fully parsed table. */
export interface ParsedTable {
  readonly header: TableRow;
  readonly alignments: readonly Alignment[];
  readonly rows: readonly TableRow[];
}

/** Result of parsing a table with its document position. */
export interface TableParseResult {
  readonly table: ParsedTable;
  /** Line offset (0-based) of the first table line in the document. */
  readonly startLine: number;
  /** Number of lines the table spans. */
  readonly lineCount: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a pipe-delimited line into trimmed cell contents. */
function splitRow(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading/trailing pipes
  const inner =
    trimmed.startsWith("|") && trimmed.endsWith("|")
      ? trimmed.slice(1, -1)
      : trimmed.startsWith("|")
        ? trimmed.slice(1)
        : trimmed.endsWith("|")
          ? trimmed.slice(0, -1)
          : trimmed;

  // Split on un-escaped pipes
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const ch of inner) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === "\\") {
      current += ch;
      escaped = true;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Detect alignment from a separator cell (e.g. `:---:`, `---:`, `:---`). */
function parseAlignmentCell(cell: string): Alignment {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/** Test whether a line is a valid separator row. */
function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-+:?$/.test(c.trim()))
  );
}

/** Test whether a line looks like a table row (has at least one pipe). */
function isTableRow(line: string): boolean {
  return line.includes("|");
}

/**
 * Detect column alignments from a separator row.
 *
 * @param separatorLine - The `| --- | :---: |` line.
 */
export function detectAlignment(separatorLine: string): Alignment[] {
  return splitRow(separatorLine).map(parseAlignmentCell);
}

/**
 * Parse a GFM pipe table from an array of lines.
 *
 * Returns `null` if the lines do not form a valid table (need at least
 * a header line and a separator line).
 */
export function parseTable(lines: readonly string[]): ParsedTable | null {
  if (lines.length < 2) return null;
  if (!isTableRow(lines[0]) || !isSeparatorRow(lines[1])) return null;

  const headerCells = splitRow(lines[0]);
  const alignments = detectAlignment(lines[1]);

  // Normalize column count to header width
  const colCount = headerCells.length;

  const padCells = (cells: string[]): TableCell[] => {
    const result: TableCell[] = [];
    for (let i = 0; i < colCount; i++) {
      result.push({ content: i < cells.length ? cells[i] : "" });
    }
    return result;
  };

  const header: TableRow = { cells: padCells(headerCells) };
  const rows: TableRow[] = [];

  for (let i = 2; i < lines.length; i++) {
    if (!isTableRow(lines[i])) break;
    rows.push({ cells: padCells(splitRow(lines[i])) });
  }

  // Pad alignments to match column count
  const paddedAlignments: Alignment[] = [];
  for (let i = 0; i < colCount; i++) {
    paddedAlignments.push(i < alignments.length ? alignments[i] : "none");
  }

  return { header, alignments: paddedAlignments, rows };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Build a separator cell string for the given alignment. */
function alignmentToSeparator(alignment: Alignment, width: number): string {
  const dashes = Math.max(width, 3);
  switch (alignment) {
    case "left":
      return ":" + "-".repeat(dashes - 1);
    case "right":
      return "-".repeat(dashes - 1) + ":";
    case "center":
      return ":" + "-".repeat(Math.max(dashes - 2, 1)) + ":";
    case "none":
      return "-".repeat(dashes);
  }
}

/** Pad a string to the given width respecting alignment. */
function padCell(content: string, width: number, alignment: Alignment): string {
  const pad = Math.max(0, width - content.length);
  switch (alignment) {
    case "right":
      return " ".repeat(pad) + content;
    case "center": {
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return " ".repeat(left) + content + " ".repeat(right);
    }
    default:
      return content + " ".repeat(pad);
  }
}

/**
 * Format a parsed table so all columns are aligned and padded.
 *
 * Returns the formatted table as a new `ParsedTable` — cell contents
 * are unchanged, only padding differs in the serialized output.
 */
export function formatTable(table: ParsedTable): string[] {
  const colCount = table.header.cells.length;

  // Compute column widths
  const widths: number[] = new Array<number>(colCount).fill(3);
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(widths[c], table.header.cells[c].content.length);
    for (const row of table.rows) {
      if (c < row.cells.length) {
        widths[c] = Math.max(widths[c], row.cells[c].content.length);
      }
    }
  }

  const serializeRow = (cells: readonly TableCell[]): string => {
    const parts = cells.map((cell, i) =>
      padCell(cell.content, widths[i], table.alignments[i] ?? "none"),
    );
    return "| " + parts.join(" | ") + " |";
  };

  const lines: string[] = [];
  lines.push(serializeRow(table.header.cells));

  // Separator row
  const sepParts = table.alignments.map((a, i) =>
    alignmentToSeparator(a, widths[i]),
  );
  lines.push("| " + sepParts.join(" | ") + " |");

  for (const row of table.rows) {
    lines.push(serializeRow(row.cells));
  }

  return lines;
}

/**
 * Serialize a parsed table back to markdown lines.
 *
 * Unlike `formatTable`, this does not pad columns.
 */
export function serializeTable(table: ParsedTable): string[] {
  const serializeRow = (cells: readonly TableCell[]): string => {
    return "| " + cells.map((c) => c.content).join(" | ") + " |";
  };

  const lines: string[] = [];
  lines.push(serializeRow(table.header.cells));

  const sepParts = table.alignments.map((a) => {
    switch (a) {
      case "left":
        return ":---";
      case "right":
        return "---:";
      case "center":
        return ":---:";
      case "none":
        return "---";
    }
  });
  lines.push("| " + sepParts.join(" | ") + " |");

  for (const row of table.rows) {
    lines.push(serializeRow(row.cells));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Mutations (return new tables, no mutation)
// ---------------------------------------------------------------------------

/** Add a new row at the given index (0 = first data row). */
export function addRow(table: ParsedTable, atIndex?: number): ParsedTable {
  const colCount = table.header.cells.length;
  const emptyRow: TableRow = {
    cells: Array.from({ length: colCount }, () => ({ content: "" })),
  };
  const rows = [...table.rows];
  const idx = atIndex ?? rows.length;
  rows.splice(idx, 0, emptyRow);
  return { ...table, rows };
}

/** Delete a row at the given index. */
export function deleteRow(table: ParsedTable, atIndex: number): ParsedTable {
  if (atIndex < 0 || atIndex >= table.rows.length) return table;
  const rows = [...table.rows];
  rows.splice(atIndex, 1);
  return { ...table, rows };
}

/** Add a new column at the given index. */
export function addColumn(
  table: ParsedTable,
  atIndex?: number,
): ParsedTable {
  const colCount = table.header.cells.length;
  const idx = atIndex ?? colCount;

  const insertCell = (
    cells: readonly TableCell[],
    value: string,
  ): TableCell[] => {
    const result = [...cells];
    result.splice(idx, 0, { content: value });
    return result;
  };

  const header: TableRow = {
    cells: insertCell(table.header.cells, ""),
  };
  const alignments = [...table.alignments];
  alignments.splice(idx, 0, "none");

  const rows = table.rows.map((row) => ({
    cells: insertCell(row.cells, ""),
  }));

  return { header, alignments, rows };
}

/** Delete a column at the given index. */
export function deleteColumn(
  table: ParsedTable,
  atIndex: number,
): ParsedTable {
  const colCount = table.header.cells.length;
  if (atIndex < 0 || atIndex >= colCount) return table;
  if (colCount <= 1) return table; // Don't delete the last column

  const removeCell = (cells: readonly TableCell[]): TableCell[] => {
    const result = [...cells];
    result.splice(atIndex, 1);
    return result;
  };

  const header: TableRow = { cells: removeCell(table.header.cells) };
  const alignments = [...table.alignments];
  alignments.splice(atIndex, 1);

  const rows = table.rows.map((row) => ({
    cells: removeCell(row.cells),
  }));

  return { header, alignments, rows };
}
