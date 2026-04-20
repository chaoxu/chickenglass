import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { SurfaceFloatingPortal } from "../lexical-next";
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
  $toggleHeaderRow,
  resolveTableCellFromDom,
} from "./table-operations";

interface MenuState {
  readonly anchor: HTMLElement;
  readonly columnCount: number;
  readonly columnIndex: number;
  readonly rowCount: number;
  readonly rowIndex: number;
  readonly tableKey: NodeKey;
}

const preventMouseDown = (e: React.MouseEvent) => e.preventDefault();

function getTableNodeKey(tableEl: HTMLElement, editor: ReturnType<typeof useLexicalComposerContext>[0]): NodeKey | null {
  // Lexical stores the node key on DOM elements as __lexicalKey_<editorKey>
  const propName = `__lexicalKey_${editor.getKey()}`;
  const candidate = (tableEl as unknown as Record<string, unknown>)[propName];
  return typeof candidate === "string" ? candidate : null;
}

function TableActionMenu({
  menuState,
  onClose,
}: {
  readonly menuState: MenuState;
  readonly onClose: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const withTable = useCallback(
    (fn: (table: TableNode) => void) => {
      editor.update(() => {
        const node = $getNodeByKey(menuState.tableKey);
        if ($isTableNode(node)) {
          fn(node);
        }
      });
      onClose();
    },
    [editor, menuState.tableKey, onClose],
  );

  const { rowIndex, columnIndex, rowCount, columnCount } = menuState;
  const isHeaderRow = rowIndex === 0;

  return (
    <div className="cf-table-action-menu" ref={menuRef} role="menu">
      <button
        className="cf-table-action-menu-item"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $insertRowBefore(t, rowIndex))}
        role="menuitem"
        type="button"
      >
        Insert row above
      </button>
      <button
        className="cf-table-action-menu-item"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $insertRowAfter(t, rowIndex))}
        role="menuitem"
        type="button"
      >
        Insert row below
      </button>
      <div className="cf-table-action-menu-separator" role="separator" />
      <button
        className="cf-table-action-menu-item"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $insertColumnBefore(t, columnIndex))}
        role="menuitem"
        type="button"
      >
        Insert column left
      </button>
      <button
        className="cf-table-action-menu-item"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $insertColumnAfter(t, columnIndex))}
        role="menuitem"
        type="button"
      >
        Insert column right
      </button>
      <div className="cf-table-action-menu-separator" role="separator" />
      {rowCount > 1 && (
        <button
          className="cf-table-action-menu-item cf-table-action-menu-item--destructive"
          onMouseDown={preventMouseDown}
          onClick={() => withTable((t) => $deleteRow(t, rowIndex))}
          role="menuitem"
          type="button"
        >
          Delete row
        </button>
      )}
      {columnCount > 1 && (
        <button
          className="cf-table-action-menu-item cf-table-action-menu-item--destructive"
          onMouseDown={preventMouseDown}
          onClick={() => withTable((t) => $deleteColumn(t, columnIndex))}
          role="menuitem"
          type="button"
        >
          Delete column
        </button>
      )}
      <button
        className="cf-table-action-menu-item cf-table-action-menu-item--destructive"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $deleteTable(t))}
        role="menuitem"
        type="button"
      >
        Delete table
      </button>
      <div className="cf-table-action-menu-separator" role="separator" />
      <button
        className="cf-table-action-menu-item"
        onMouseDown={preventMouseDown}
        onClick={() => withTable((t) => $toggleHeaderRow(t))}
        role="menuitem"
        type="button"
      >
        {isHeaderRow ? "Remove header row" : "Toggle header row"}
      </button>
    </div>
  );
}

export function TableActionMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menuState, setMenuState] = useState<MenuState | null>(null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const resolved = resolveTableCellFromDom(target);
      if (!resolved) return;

      const tableKey = getTableNodeKey(resolved.tableEl, editor);
      if (!tableKey) return;

      let rowCount = 0;
      let columnCount = 0;
      editor.read(() => {
        const node = $getNodeByKey(tableKey);
        if ($isTableNode(node)) {
          rowCount = node.getChildren().filter($isTableRowNode).length;
          columnCount = node.getAlignments().length;
        }
      });

      event.preventDefault();
      setMenuState({
        anchor: resolved.cell,
        columnCount,
        columnIndex: resolved.columnIndex,
        rowCount,
        rowIndex: resolved.rowIndex,
        tableKey,
      });
    };

    return editor.registerRootListener((rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener("contextmenu", handleContextMenu);
      if (!rootElement) {
        return;
      }
      rootElement.addEventListener("contextmenu", handleContextMenu);
      return () => {
        rootElement.removeEventListener("contextmenu", handleContextMenu);
      };
    });
  }, [editor]);

  const handleClose = useCallback(() => {
    setMenuState(null);
  }, []);

  if (!menuState) return null;

  return (
    <SurfaceFloatingPortal
      anchor={menuState.anchor}
      className="cf-table-action-menu-portal"
      placement="bottom-start"
      visible
      zIndex={70}
    >
      <TableActionMenu menuState={menuState} onClose={handleClose} />
    </SurfaceFloatingPortal>
  );
}
