export interface MarkdownTable {
  readonly alignments: ReadonlyArray<"center" | "left" | "right" | null>;
  readonly dividerCells?: ReadonlyArray<string>;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
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
  return cell.replaceAll("|", "\\|");
}

function serializeTableRow(cells: readonly string[]): string {
  return `| ${cells.map(serializeTableCell).join(" | ")} |`;
}

function serializeTableDivider(cells: readonly string[]): string {
  return `|${cells.join("|")}|`;
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
