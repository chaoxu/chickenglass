import type { EditorView } from "@codemirror/view";
import { createInlineEditorController } from "../inline-editor";
import { coarseHitTestPosition, preciseHitTestPosition } from "../lib/editor-hit-test";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import { bibDataField } from "../state/bib-data";
import type { InlineReferenceRenderContext } from "./inline-render";
import type { TableRange } from "./table-discovery";
import type { ParsedTable } from "./table-utils";
import { appendTableWidgetRowAndFocus, showTableWidgetContextMenu } from "./table-widget-mutations";
import {
  findTableInlineNeutralAnchor,
  isRenderedTableInlineTarget,
} from "./table-widget-preview";
import {
  createTableNavigationModel,
  moveTableCellByTab,
  moveTableCellHorizontally,
  moveTableCellVertically,
  type TableBoundaryHandoffDirection,
  type TableCellAddress,
  type TableCellNavigationIntent,
} from "./table-widget-navigation";
import {
  clearActivePreviewCell,
  commitDestroyedInlineEditor,
  destroyActiveInlineEditor,
  getActiveInlineEditor,
  isActiveInlineCell,
  isActivePreviewCell,
  restoreDestroyedInlineEditorLocally,
  setActiveInlineEditor,
  setActivePreviewCell,
  shouldCommitBlurredInlineEditor,
  type TableWidgetSessionOwner,
} from "./table-widget-session";
import { consumeTableKeyboardEvent } from "./table-widget-keyboard-entry";

export interface TableWidgetDomOptions {
  readonly view: EditorView;
  readonly owner: TableWidgetSessionOwner;
  readonly table: ParsedTable;
  readonly tableFrom: number;
  readonly macros: Record<string, string>;
  readonly referenceContext: InlineReferenceRenderContext | undefined;
  readonly getRootView: () => EditorView | null;
  readonly currentTableRange: () => TableRange | null;
  readonly getRawCellText: (address: TableCellAddress) => string;
  readonly restoreRenderedCell: (
    cell: HTMLElement,
    content: string,
    referenceContext?: InlineReferenceRenderContext,
  ) => void;
  readonly syncToRoot: (
    address: TableCellAddress,
    editedText: string,
    annotation: "edit" | "commit",
  ) => void;
}

interface OpenCellEditorOptions {
  readonly placeAtEnd?: boolean;
  readonly clickX?: number;
  readonly clickY?: number;
  readonly initialAnchor?: number | null;
  readonly useClickPlacement?: boolean;
}

export function buildTableWidgetDOM(options: TableWidgetDomOptions): HTMLTableElement {
  const tableEl = document.createElement("table");
  const navigationModel = createTableNavigationModel(options.table);

  const findCell = (address: TableCellAddress): HTMLElement | null => {
    const target = tableEl.querySelector(
      `[data-section="${address.section}"][data-row="${address.row}"][data-col="${address.col}"]`,
    ) as HTMLElement | null;
    return target;
  };

  const focusTargetCell = (address: TableCellAddress): void => {
    const target = findCell(address);
    if (target) {
      setActivePreviewCell(target, options.owner);
    }
  };

  const addRowAndFocus = (targetCol: number): void => {
    const rootView = options.getRootView();
    if (!rootView) return;
    appendTableWidgetRowAndFocus({
      rootView,
      tableRange: options.currentTableRange(),
      tableFrom: options.tableFrom,
      bodyRowCount: navigationModel.bodyRowCount,
      targetCol,
    });
  };

  const handoffFromActiveEditor = (
    direction: TableBoundaryHandoffDirection,
  ): boolean => {
    const rootView = options.getRootView();
    const tableRange = options.currentTableRange();
    const destroyed = destroyActiveInlineEditor();
    if (!destroyed) return true;
    commitDestroyedInlineEditor(destroyed);
    if (rootView && tableRange) {
      destroyed.owner.focusRootOutsideTableWithRange(rootView, tableRange, direction);
    }
    return true;
  };

  const activateTargetCell = (
    address: TableCellAddress,
    placeAtEnd = false,
  ): void => {
    if (getActiveInlineEditor()) {
      const destroyed = destroyActiveInlineEditor();
      if (!destroyed) return;
      restoreDestroyedInlineEditorLocally(destroyed, options.owner);
    }

    const target = findCell(address);
    if (target) {
      openCellEditor(target, address, { placeAtEnd });
    }
  };

  const applyCellIntent = (intent: TableCellNavigationIntent): void => {
    if (intent.kind === "handoff") {
      options.owner.focusRootOutsideTable(intent.direction);
      return;
    }
    activateTargetCell(intent.address, intent.placeAtEnd === true);
  };

  const openCellEditor = (
    cell: HTMLElement,
    address: TableCellAddress,
    {
      placeAtEnd = false,
      clickX = 0,
      clickY = 0,
      initialAnchor = null,
      useClickPlacement = false,
    }: OpenCellEditorOptions = {},
  ): void => {
    clearActivePreviewCell();
    const rawText = options.getRawCellText(address);
    cell.innerHTML = "";
    cell.classList.add("cf-table-cell-editing");

    const rootView = options.getRootView();
    const bibData = rootView?.state.field?.(bibDataField, false);
    const referenceCatalog = rootView && typeof rootView.state.field === "function"
      ? getEditorDocumentReferenceCatalog(rootView.state)
      : undefined;
    const controller = createInlineEditorController({
      parent: cell,
      doc: rawText,
      macros: options.macros,
      bibData: bibData ?? undefined,
      referenceCatalog,
      onChange: () => {},
    });

    controller.setCallbacks({
      onChange: (newDoc) => {
        options.syncToRoot(address, newDoc, "edit");
      },
      onBlur: () => {
        const blurredEditor = getActiveInlineEditor();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              document.activeElement instanceof HTMLElement &&
              cell.contains(document.activeElement)
            ) {
              return;
            }
            if (!shouldCommitBlurredInlineEditor(
              blurredEditor,
              getActiveInlineEditor(),
              cell,
            )) {
              return;
            }
            const destroyed = destroyActiveInlineEditor();
            if (!destroyed) return;

            commitDestroyedInlineEditor(destroyed);
          });
        });
      },
      onKeydown: (event) => {
        if (event.key === "Escape") {
          consumeTableKeyboardEvent(event);
          const destroyed = destroyActiveInlineEditor();
          if (!destroyed) return true;
          commitDestroyedInlineEditor(destroyed);
          options.getRootView()?.focus();
          return true;
        }

        if (event.key === "Tab") {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellByTab(navigationModel, address, event.shiftKey);
          if (intent.kind === "append-row") {
            const destroyed = destroyActiveInlineEditor();
            if (!destroyed) return true;
            commitDestroyedInlineEditor(destroyed);
            addRowAndFocus(intent.col);
          } else if (intent.kind === "cell") {
            activateTargetCell(intent.address, intent.placeAtEnd === true);
          } else {
            return true;
          }
          return true;
        }

        if (event.key === "Enter") {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellVertically(navigationModel, address, "down");
          if (intent.kind === "handoff") {
            const destroyed = destroyActiveInlineEditor();
            if (!destroyed) return true;
            commitDestroyedInlineEditor(destroyed);
            addRowAndFocus(address.col);
          } else {
            activateTargetCell(intent.address);
          }
          return true;
        }

        const active = getActiveInlineEditor();
        if (!active) return false;
        const pos = active.view.state.selection.main.head;
        const len = active.view.state.doc.length;

        if (event.key === "ArrowLeft" && pos === 0) {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellHorizontally(navigationModel, address, "left");
          if (intent.kind === "handoff") return handoffFromActiveEditor(intent.direction);
          applyCellIntent(intent);
          return true;
        }

        if (event.key === "ArrowRight" && pos === len) {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellHorizontally(navigationModel, address, "right");
          if (intent.kind === "handoff") return handoffFromActiveEditor(intent.direction);
          applyCellIntent(intent);
          return true;
        }

        if (event.key === "ArrowUp") {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellVertically(navigationModel, address, "up");
          if (intent.kind === "handoff") return handoffFromActiveEditor(intent.direction);
          applyCellIntent(intent);
          return true;
        }

        if (event.key === "ArrowDown") {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellVertically(navigationModel, address, "down");
          if (intent.kind === "handoff") return handoffFromActiveEditor(intent.direction);
          applyCellIntent(intent);
          return true;
        }

        if (event.key === "Backspace" && pos === 0) {
          consumeTableKeyboardEvent(event);
          return true;
        }
        if (event.key === "Delete" && pos === len) {
          consumeTableKeyboardEvent(event);
          return true;
        }

        return false;
      },
    });
    const editorView = controller.view;

    setActiveInlineEditor({ controller, view: editorView, cell, owner: options.owner });

    const refocusEditor = (): void => {
      if (getActiveInlineEditor()?.view !== editorView) return;
      editorView.focus();
    };

    let hasInitialSelection = false;

    const applyInitialSelection = (anchor: number): void => {
      if (getActiveInlineEditor()?.view !== editorView) return;
      editorView.dispatch({ selection: { anchor } });
      hasInitialSelection = true;
    };

    const applyClickPlacement = (): boolean => {
      if (getActiveInlineEditor()?.view !== editorView) return false;
      const point = { x: clickX, y: clickY };
      const precise = preciseHitTestPosition(editorView, point);
      if (precise) {
        applyInitialSelection(precise.pos);
        return true;
      }

      const coarse = coarseHitTestPosition(editorView, point);
      if (coarse) {
        applyInitialSelection(coarse.pos);
        return true;
      }

      return false;
    };

    if (typeof initialAnchor === "number") {
      applyInitialSelection(initialAnchor);
    } else if (placeAtEnd) {
      const docLen = editorView.state.doc.length;
      applyInitialSelection(docLen);
    } else if (useClickPlacement) {
      applyClickPlacement();
    }

    if (hasInitialSelection || !useClickPlacement) {
      refocusEditor();
    }

    const scheduleRefocus = (): void => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refocusEditor();
        });
      });
    };

    if (!useClickPlacement || hasInitialSelection) {
      scheduleRefocus();
    } else {
      requestAnimationFrame(() => {
        if (!hasInitialSelection && applyClickPlacement()) {
          refocusEditor();
          scheduleRefocus();
          return;
        }
        refocusEditor();
      });
    }
  };

  const setupCell = (
    cell: HTMLElement,
    section: TableCellAddress["section"],
    row: number,
    col: number,
    content: string,
  ): void => {
    const address: TableCellAddress = { section, row, col };
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    cell.dataset.section = section;

    const align = options.table.alignments[col];
    if (align && align !== "none") {
      cell.style.textAlign = align;
    }

    options.restoreRenderedCell(cell, content, options.referenceContext);

    cell.addEventListener("keydown", (event) => {
      if (!isActivePreviewCell(cell, options.owner)) return;

      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        consumeTableKeyboardEvent(event);
        openCellEditor(cell, address);
        requestAnimationFrame(() => {
          const active = getActiveInlineEditor();
          if (active?.cell !== cell) return;
          const selection = active.view.state.selection.main;
          active.view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: event.key },
            selection: { anchor: selection.from + event.key.length },
            userEvent: "input.type",
          });
        });
        return;
      }

      if (event.key === "Enter" || event.key === "F2") {
        consumeTableKeyboardEvent(event);
        openCellEditor(cell, address);
        return;
      }

      if (event.key === "Escape") {
        consumeTableKeyboardEvent(event);
        clearActivePreviewCell();
        options.getRootView()?.focus();
        return;
      }

      if (event.key === "ArrowLeft") {
        consumeTableKeyboardEvent(event);
        const intent = moveTableCellHorizontally(navigationModel, address, "left");
        if (intent.kind === "handoff") {
          clearActivePreviewCell();
          options.owner.focusRootOutsideTable(intent.direction);
        } else {
          focusTargetCell(intent.address);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        consumeTableKeyboardEvent(event);
        const intent = moveTableCellHorizontally(navigationModel, address, "right");
        if (intent.kind === "handoff") {
          clearActivePreviewCell();
          options.owner.focusRootOutsideTable(intent.direction);
        } else {
          focusTargetCell(intent.address);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        consumeTableKeyboardEvent(event);
        const intent = moveTableCellVertically(navigationModel, address, "up");
        if (intent.kind === "handoff") {
          clearActivePreviewCell();
          options.owner.focusRootOutsideTable(intent.direction);
        } else {
          focusTargetCell(intent.address);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        consumeTableKeyboardEvent(event);
        const intent = moveTableCellVertically(navigationModel, address, "down");
        if (intent.kind === "handoff") {
          clearActivePreviewCell();
          options.owner.focusRootOutsideTable(intent.direction);
        } else {
          focusTargetCell(intent.address);
        }
        return;
      }
    });

    cell.addEventListener("blur", () => {
      setTimeout(() => {
        if (!isActivePreviewCell(cell, options.owner)) return;
        if (document.activeElement === cell) return;
        clearActivePreviewCell();
      }, 0);
    });

    cell.addEventListener("mousedown", (event) => {
      try {
        if (isActiveInlineCell(cell)) return;

        event.preventDefault();
        event.stopPropagation();

        const clickX = event.clientX;
        const clickY = event.clientY;
        const placeAtEnd = cell.dataset.placeAtEnd === "true";
        const clickedRenderedToken = isRenderedTableInlineTarget(event.target);
        const initialAnchor = clickedRenderedToken
          ? findTableInlineNeutralAnchor(options.getRawCellText(address))
          : null;
        delete cell.dataset.placeAtEnd;

        if (getActiveInlineEditor()) {
          const destroyed = destroyActiveInlineEditor();
          if (destroyed) {
            restoreDestroyedInlineEditorLocally(destroyed, options.owner);
          }
        }

        openCellEditor(cell, address, {
          placeAtEnd,
          clickX,
          clickY,
          initialAnchor,
          useClickPlacement:
            event.isTrusted && (!clickedRenderedToken || initialAnchor === null),
        });
      } catch (e: unknown) {
        console.error("[table-widget] mousedown handler failed", e);
      }
    });

    cell.addEventListener("click", (event) => {
      if (isActiveInlineCell(cell)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  };

  const thead = document.createElement("thead");
  const headerTr = document.createElement("tr");
  const headerCells = options.table.header.cells;

  for (let col = 0; col < headerCells.length; col++) {
    const th = document.createElement("th");
    setupCell(th, "header", 0, col, headerCells[col].content);
    headerTr.appendChild(th);
  }

  thead.appendChild(headerTr);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (let row = 0; row < options.table.rows.length; row++) {
    const tr = document.createElement("tr");
    const rowCells = options.table.rows[row].cells;

    for (let col = 0; col < rowCells.length; col++) {
      const td = document.createElement("td");
      setupCell(td, "body", row, col, rowCells[col].content);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  tableEl.appendChild(tbody);

  tableEl.addEventListener("contextmenu", (event: MouseEvent) => {
    showTableWidgetContextMenu(options.view, options.tableFrom, tableEl, event);
  });

  return tableEl;
}
