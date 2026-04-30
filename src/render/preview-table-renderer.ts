import type { SyntaxNode } from "@lezer/common";
import type { PreviewRenderContext } from "./preview-render-context";
import { renderInlineSyntaxNodeToDom } from "./inline-render";

export function renderPreviewTable(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const delimiterNode = node.getChild("TableDelimiter");
  if (!delimiterNode) return;

  const alignments = parseTableAlignments(context.doc.slice(delimiterNode.from, delimiterNode.to));
  const headerNode = node.getChild("TableHeader");
  const headerCells = headerNode?.getChildren("TableCell") ?? [];
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  thead.appendChild(renderTableRow(headerCells, "th", alignments, context));

  let child = node.firstChild;
  while (child) {
    if (child.name === "TableRow") {
      tbody.appendChild(renderTableRow(child.getChildren("TableCell"), "td", alignments, context));
    }
    child = child.nextSibling;
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  parent.appendChild(table);
}

function renderTableRow(
  cells: readonly SyntaxNode[],
  tag: "th" | "td",
  alignments: readonly string[],
  context: PreviewRenderContext,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (let index = 0; index < alignments.length; index += 1) {
    const cell = document.createElement(tag);
    const align = alignments[index];
    if (align) {
      cell.style.textAlign = align;
    }
    const cellNode = cells[index];
    if (cellNode) {
      renderInlineSyntaxNodeToDom(
        cell,
        cellNode,
        context.doc,
        context.macros,
        "document-body",
        context.referenceContext,
      );
    }
    row.appendChild(cell);
  }
  return row;
}

export function parseTableAlignments(delimiterRow: string): string[] {
  const cells = delimiterRow
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}
