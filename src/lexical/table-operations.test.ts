import { $getRoot } from "lexical";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createHeadlessCoflatEditor,
  setLexicalMarkdown,
} from "./markdown";
import { $isTableCellNode } from "./nodes/table-cell-node";
import { $isTableNode, type TableNode } from "./nodes/table-node";
import { $isTableRowNode } from "./nodes/table-row-node";
import {
  $deleteColumn,
  $deleteRow,
  $deleteTable,
  $insertColumnAfter,
  $insertColumnBefore,
  $insertRowAfter,
  $insertRowBefore,
  $toggleHeaderColumn,
  $toggleHeaderRow,
} from "./table-operations";

const TABLE_MD = `| H1  | H2  | H3  |
| --- | --- | --- |
| a   | b   | c   |
| d   | e   | f   |`;

/** Find the first table node inside a Lexical $ context. Throws if absent. */
function $findTable(): TableNode {
  const table = $getRoot().getChildren().find($isTableNode);
  if (!table) throw new Error("No table found in editor");
  return table;
}

function getRowCount(editor: ReturnType<typeof createHeadlessCoflatEditor>): number {
  let count = 0;
  editor.read(() => {
    const table = $getRoot().getChildren().find($isTableNode);
    if (table) {
      count = table.getChildren().filter($isTableRowNode).length;
    }
  });
  return count;
}

function getColumnCount(editor: ReturnType<typeof createHeadlessCoflatEditor>): number {
  let count = 0;
  editor.read(() => {
    const table = $getRoot().getChildren().find($isTableNode);
    if (table) {
      count = table.getAlignments().length;
    }
  });
  return count;
}

describe("table operations", () => {
  let editor: ReturnType<typeof createHeadlessCoflatEditor>;

  beforeEach(() => {
    editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, TABLE_MD);
  });

  describe("$insertRowAfter", () => {
    it("inserts a row after the given index", () => {
      expect(getRowCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $insertRowAfter(table, 1);
      }, { discrete: true });
      expect(getRowCount(editor)).toBe(4);
    });
  });

  describe("$insertRowBefore", () => {
    it("inserts a row before the given index", () => {
      expect(getRowCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $insertRowBefore(table, 2);
      }, { discrete: true });
      expect(getRowCount(editor)).toBe(4);
    });

    it("demotes old header row when inserting before row 0", () => {
      editor.update(() => {
        const table = $findTable();
        $insertRowBefore(table, 0);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        // New row at index 0 should be header
        const newHeaderCells = rows[0].getChildren().filter($isTableCellNode);
        expect(newHeaderCells.every((c) => c.isHeader())).toBe(true);
        // Old header row (now index 1) should be demoted
        const oldHeaderCells = rows[1].getChildren().filter($isTableCellNode);
        expect(oldHeaderCells.every((c) => !c.isHeader())).toBe(true);
      });
    });
  });

  describe("$deleteRow", () => {
    it("removes the row at the given index", () => {
      expect(getRowCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $deleteRow(table, 2);
      }, { discrete: true });
      expect(getRowCount(editor)).toBe(2);
    });

    it("refuses to delete the last row", () => {
      // Delete down to 1 row
      editor.update(() => {
        const table = $findTable();
        $deleteRow(table, 2);
        $deleteRow(table, 1);
      }, { discrete: true });
      expect(getRowCount(editor)).toBe(1);

      // Attempt to delete the last row
      editor.update(() => {
        const table = $findTable();
        $deleteRow(table, 0);
      }, { discrete: true });
      expect(getRowCount(editor)).toBe(1);
    });

    it("promotes new first row to header when deleting header row", () => {
      editor.update(() => {
        const table = $findTable();
        $deleteRow(table, 0);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        const firstRowCells = rows[0].getChildren().filter($isTableCellNode);
        expect(firstRowCells.every((c) => c.isHeader())).toBe(true);
      });
    });
  });

  describe("$insertColumnAfter", () => {
    it("increases column count", () => {
      expect(getColumnCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $insertColumnAfter(table, 1);
      }, { discrete: true });
      expect(getColumnCount(editor)).toBe(4);
    });
  });

  describe("$insertColumnBefore", () => {
    it("increases column count", () => {
      expect(getColumnCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $insertColumnBefore(table, 0);
      }, { discrete: true });
      expect(getColumnCount(editor)).toBe(4);
    });
  });

  describe("$deleteColumn", () => {
    it("decreases column count", () => {
      expect(getColumnCount(editor)).toBe(3);
      editor.update(() => {
        const table = $findTable();
        $deleteColumn(table, 2);
      }, { discrete: true });
      expect(getColumnCount(editor)).toBe(2);
    });

    it("refuses to delete the last column", () => {
      editor.update(() => {
        const table = $findTable();
        $deleteColumn(table, 2);
        $deleteColumn(table, 1);
      }, { discrete: true });
      expect(getColumnCount(editor)).toBe(1);

      editor.update(() => {
        const table = $findTable();
        $deleteColumn(table, 0);
      }, { discrete: true });
      expect(getColumnCount(editor)).toBe(1);
    });
  });

  describe("$toggleHeaderRow", () => {
    it("toggles header state on first row cells", () => {
      // Initially header row has header=true
      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        const cells = rows[0].getChildren().filter($isTableCellNode);
        expect(cells.every((c) => c.isHeader())).toBe(true);
      });

      // Toggle off
      editor.update(() => {
        const table = $findTable();
        $toggleHeaderRow(table);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        const cells = rows[0].getChildren().filter($isTableCellNode);
        expect(cells.every((c) => !c.isHeader())).toBe(true);
      });

      // Toggle back on
      editor.update(() => {
        const table = $findTable();
        $toggleHeaderRow(table);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        const cells = rows[0].getChildren().filter($isTableCellNode);
        expect(cells.every((c) => c.isHeader())).toBe(true);
      });
    });
  });

  describe("$toggleHeaderColumn", () => {
    it("toggles header state on cells in the given column", () => {
      // Initially column 0 cells: first row is header, others are not
      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        const firstCell = rows[0].getChildren().filter($isTableCellNode)[0];
        expect(firstCell.isHeader()).toBe(true);
        const secondCell = rows[1].getChildren().filter($isTableCellNode)[0];
        expect(secondCell.isHeader()).toBe(false);
      });

      // Toggle column 1 on (first row cell is header, so toggle will turn all off)
      editor.update(() => {
        const table = $findTable();
        $toggleHeaderColumn(table, 1);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        // Column 1: first row was header, so all should now be non-header
        for (const row of rows) {
          const cell = row.getChildren().filter($isTableCellNode)[1];
          expect(cell.isHeader()).toBe(false);
        }
      });

      // Toggle column 1 again — should turn all on
      editor.update(() => {
        const table = $findTable();
        $toggleHeaderColumn(table, 1);
      }, { discrete: true });

      editor.read(() => {
        const table = $findTable();
        const rows = table.getChildren().filter($isTableRowNode);
        for (const row of rows) {
          const cell = row.getChildren().filter($isTableCellNode)[1];
          expect(cell.isHeader()).toBe(true);
        }
      });
    });
  });

  describe("$deleteTable", () => {
    it("removes the table from the tree", () => {
      editor.update(() => {
        const table = $findTable();
        $deleteTable(table);
      }, { discrete: true });

      editor.read(() => {
        const table = $getRoot().getChildren().find($isTableNode);
        expect(table).toBeUndefined();
      });
    });
  });
});
