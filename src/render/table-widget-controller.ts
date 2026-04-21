import { Annotation } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  findClosestTable,
  findTablesInState,
  type TableRange,
} from "./table-discovery";
import { formatTable, type ParsedTable } from "./table-utils";
import type { TableCellAddress } from "./table-widget-navigation";

/**
 * Annotation attached to transactions dispatched by cell-edit sync.
 *
 * - `"edit"`: live keystroke while the inline editor is open — the
 *   StateField maps existing decorations through the change so the
 *   widget (and its nested editor) is not destroyed mid-edit.
 * - `"commit"`: the inline editor has been destroyed and the final
 *   content synced back — the StateField does a full rebuild so the
 *   rendered table reflects the new content.
 */
export const cellEditAnnotation = Annotation.define<"edit" | "commit">();

export class TableWidgetController {
  constructor(
    private table: ParsedTable,
    private trackedTableFrom: number,
    private readonly getRootView: () => EditorView | null,
  ) {}

  get currentTable(): ParsedTable {
    return this.table;
  }

  get tableFrom(): number {
    return this.trackedTableFrom;
  }

  getRawCellText(address: TableCellAddress): string {
    if (address.section === "header") {
      return address.col < this.table.header.cells.length
        ? this.table.header.cells[address.col].content
        : "";
    }
    if (
      address.row < this.table.rows.length &&
      address.col < this.table.rows[address.row].cells.length
    ) {
      return this.table.rows[address.row].cells[address.col].content;
    }
    return "";
  }

  replaceLocalCell(address: TableCellAddress, newContent: string): void {
    this.table = this.buildUpdatedTable(address, newContent);
  }

  currentTableRange(): TableRange | null {
    const rootView = this.getRootView();
    if (!rootView) return null;
    return findClosestTable(findTablesInState(rootView.state), this.trackedTableFrom) ?? null;
  }

  syncToRoot(
    address: TableCellAddress,
    editedText: string,
    annotation: "edit" | "commit",
  ): void {
    const rootView = this.getRootView();
    if (!rootView) return;
    const currentTables = findTablesInState(rootView.state);
    const bestTable = findClosestTable(currentTables, this.trackedTableFrom);
    if (!bestTable) return;
    this.trackedTableFrom = bestTable.from;
    const currentText = rootView.state.sliceDoc(bestTable.from, bestTable.to);
    const updated = this.buildUpdatedTable(address, editedText);
    const newText = formatTable(updated).join("\n");
    if (newText === currentText) {
      // The document already reflects the edit (synced by live keystrokes).
      // On commit we still need to dispatch the annotation so the StateField
      // rebuilds the widget with the current ParsedTable — otherwise the old
      // widget's stale table data will be used on re-entry (#404).
      if (annotation === "commit") {
        rootView.dispatch({
          annotations: cellEditAnnotation.of("commit"),
        });
      }
      return;
    }
    rootView.dispatch({
      changes: { from: bestTable.from, to: bestTable.to, insert: newText },
      annotations: cellEditAnnotation.of(annotation),
    });
  }

  private buildUpdatedTable(
    address: TableCellAddress,
    newContent: string,
  ): ParsedTable {
    if (address.section === "header") {
      const cells = this.table.header.cells.map((cell, index) =>
        index === address.col ? { content: newContent } : cell,
      );
      return { ...this.table, header: { cells } };
    }
    const rows = this.table.rows.map((tableRow, rowIndex) => {
      if (rowIndex !== address.row) return tableRow;
      const cells = tableRow.cells.map((cell, colIndex) =>
        colIndex === address.col ? { content: newContent } : cell,
      );
      return { cells };
    });
    return { ...this.table, rows };
  }
}
