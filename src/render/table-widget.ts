import { EditorView } from "@codemirror/view";
import {
  createInlineEditorController,
} from "../inline-editor";
import { coarseHitTestPosition, preciseHitTestPosition } from "../lib/editor-hit-test";
import type { InlineReferenceRenderContext } from "./inline-render";
import { showWidgetContextMenu, applyTableMutation } from "./table-actions";
import {
  findClosestWidgetContainer,
  findTablesInState,
  type TableRange,
} from "./table-discovery";
import { addRow, type ParsedTable } from "./table-utils";
import {
  syncActiveFenceGuideClasses,
} from "./source-widget";
import { ShellWidget } from "./shell-widget";
import {
  cellEditAnnotation,
  TableWidgetController,
} from "./table-widget-controller";
import {
  clearActivePreviewCell,
  clearPreviewCellForOwner,
  commitDestroyedInlineEditor,
  destroyActiveInlineEditor,
  destroyInlineEditorForOwner,
  getActiveInlineEditor,
  isActiveInlineCell,
  isActivePreviewCell,
  restoreDestroyedInlineEditorLocally,
  setActiveInlineEditor,
  setActivePreviewCell,
  shouldCommitBlurredInlineEditor,
  transferTableWidgetSessionOwner,
  type TableWidgetSessionOwner,
} from "./table-widget-session";
import {
  findTableInlineNeutralAnchor,
  isRenderedTableInlineTarget,
  restoreRenderedTableCell,
} from "./table-widget-preview";
import {
  createTableNavigationModel,
  moveTableCellByTab,
  moveTableCellHorizontally,
  moveTableCellVertically,
  readTableCellAddress,
  type TableBoundaryHandoffDirection,
  type TableCellAddress,
  type TableCellNavigationIntent,
} from "./table-widget-navigation";
import { TableWidgetShellAdapter } from "./table-widget-shell-adapter";
import {
  WIDGET_KEYBOARD_ENTRY_EVENT,
  type WidgetKeyboardEntryDetail,
} from "../state/widget-keyboard-entry";
import { bibDataField } from "../state/bib-data";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import { getOptionalReferenceRenderState } from "../state/reference-render-state";
import {
  createEditorReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
} from "../references/presentation";

export { cellEditAnnotation, shouldCommitBlurredInlineEditor };

const tableKeyboardEntryHandlers = new WeakMap<HTMLElement, EventListener>();

function consumeTableKeyboardEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function serializeTableWidgetMacros(macros: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(macros).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Widget that renders a markdown table as an HTML <table> element.
 *
 * Used with Decoration.replace to show a rendered table. Cells display
 * rendered inline markdown by default. On click, an InlineEditor (nested
 * CM6 instance) is created inside the cell for Typora-style editing:
 * math renders with KaTeX, bold/italic markers are hidden when the
 * cursor is not adjacent, and the cell has its own undo/redo stack.
 * Only one cell editor is active at a time.
 */
export class TableWidget extends ShellWidget implements TableWidgetSessionOwner {
  /** Reference to the EditorView, stored on first toDOM() call. */
  private editorView: EditorView | null = null;
  private readonly controller: TableWidgetController;
  private readonly shellAdapter = new TableWidgetShellAdapter();
  private readonly macroSignature: string;
  private readonly renderSignature: string;

  constructor(
    table: ParsedTable,
    private readonly tableText: string,
    tableFrom: number,
    private readonly macros: Record<string, string>,
    renderSignature = "",
  ) {
    super();
    this.controller = new TableWidgetController(
      table,
      tableFrom,
      () => this.editorView,
    );
    this.macroSignature = serializeTableWidgetMacros(macros);
    this.renderSignature = renderSignature;
  }

  private get table(): ParsedTable {
    return this.controller.currentTable;
  }

  private get tableFrom(): number {
    return this.controller.tableFrom;
  }

  private ensureSourceRange(): void {
    if (this.sourceFrom >= 0 && this.sourceTo >= this.sourceFrom) return;
    this.updateSourceRange(this.tableFrom, this.tableFrom + this.tableText.length);
  }

  /**
   * Content-based equality check for DOM reuse.
   * If the table text changed, CM6 will rebuild the DOM via toDOM().
   */
  eq(other: TableWidget): boolean {
    return (
      this.tableText === other.tableText &&
      this.macroSignature === other.macroSignature &&
      this.renderSignature === other.renderSignature
    );
  }

  private restoreRenderedCell(
    cell: HTMLElement,
    content: string,
    referenceContext = this.createReferenceRenderContext(),
  ): void {
    restoreRenderedTableCell(cell, content, this.macros, referenceContext);
  }

  private createReferenceRenderContext(): InlineReferenceRenderContext | undefined {
    const rootView = this.editorView;
    if (!rootView || typeof rootView.state.field !== "function") {
      return undefined;
    }
    const { analysis, bibliography } = getOptionalReferenceRenderState(rootView.state);
    if (!analysis || !bibliography) {
      return undefined;
    }
    const { store, cslProcessor } = bibliography;
    ensureEditorReferencePresentationCitationsRegistered(analysis, store, cslProcessor);
    return createEditorReferencePresentationController(rootView.state, {
      store,
      cslProcessor,
    });
  }

  private syncToRoot(
    address: TableCellAddress,
    editedText: string,
    annotation: "edit" | "commit",
  ): void {
    this.controller.syncToRoot(address, editedText, annotation);
  }

  commitRenderedCell(
    cell: HTMLElement,
    content: string,
  ): void {
    this.restoreRenderedCell(cell, content);
    this.syncToRoot(readTableCellAddress(cell), content, "commit");
  }

  applyLocalCellEdit(
    cell: HTMLElement,
    content: string,
  ): void {
    this.restoreRenderedCell(cell, content);
    this.controller.replaceLocalCell(readTableCellAddress(cell), content);
  }

  private syncContainerAttrs(container: HTMLElement): void {
    this.ensureSourceRange();
    container.className = "cf-table-widget";
    container.dataset.tableTextHash = this.tableText;
    container.dataset.tableFrom = String(this.tableFrom);
    this.syncWidgetAttrs(container);
    container.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(
      container,
      this.editorView ?? undefined,
      this.sourceFrom,
      this.sourceTo,
    );
  }

  private commitActiveInlineEditorForKeyboardEntry(): boolean {
    const activeInlineEditor = getActiveInlineEditor();
    if (!activeInlineEditor) return true;
    const destroyed = destroyActiveInlineEditor();
    if (!destroyed) return false;

    if (destroyed.owner === this) {
      destroyed.owner.applyLocalCellEdit(destroyed.cell, destroyed.text);
    } else {
      destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
    }
    return true;
  }

  private enterPreviewCellFromKeyboard(
    container: HTMLElement,
    direction: "up" | "down",
  ): boolean {
    const cells = Array.from(
      container.querySelectorAll<HTMLElement>("[data-section][data-row][data-col]"),
    );
    const target = direction === "up" ? cells[cells.length - 1] : cells[0];
    if (!target) return false;
    if (!this.commitActiveInlineEditorForKeyboardEntry()) return false;

    setActivePreviewCell(target, this);
    return true;
  }

  private bindKeyboardEntry(container: HTMLElement): void {
    const previousHandler = tableKeyboardEntryHandlers.get(container);
    if (previousHandler) {
      container.removeEventListener(WIDGET_KEYBOARD_ENTRY_EVENT, previousHandler);
    }

    const handler = (event: Event): void => {
      const customEvent = event as CustomEvent<WidgetKeyboardEntryDetail>;
      const direction = customEvent.detail?.direction;
      if (direction !== "up" && direction !== "down") return;
      if (!this.enterPreviewCellFromKeyboard(container, direction)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener(WIDGET_KEYBOARD_ENTRY_EVENT, handler);
    tableKeyboardEntryHandlers.set(container, handler);
  }
  private currentTableRange(): TableRange | null {
    return this.controller.currentTableRange();
  }

  focusRootOutsideTable(direction: TableBoundaryHandoffDirection): boolean {
    const rootView = this.editorView;
    const tableRange = this.currentTableRange();
    if (!rootView || !tableRange) return false;

    return this.focusRootOutsideTableWithRange(rootView, tableRange, direction);
  }

  focusRootOutsideTableWithRange(
    rootView: EditorView,
    tableRange: TableRange,
    direction: TableBoundaryHandoffDirection,
  ): boolean {
    if (!rootView.dom.isConnected) return false;

    const doc = rootView.state.doc;
    const baselineScrollTop = rootView.scrollDOM.scrollTop;
    const startLine = doc.lineAt(tableRange.from);
    const endLine = doc.lineAt(Math.max(tableRange.from, tableRange.to - 1));
    const targetPos = direction === "before"
      ? Math.max(0, startLine.from - 1)
      : Math.min(doc.length, endLine.to + 1);
    const preserveDirectionalScroll = (): void => {
      const currentScrollTop = rootView.scrollDOM.scrollTop;
      const nextScrollTop = direction === "after"
        ? Math.max(currentScrollTop, baselineScrollTop)
        : Math.min(currentScrollTop, baselineScrollTop);
      if (nextScrollTop !== currentScrollTop) {
        rootView.scrollDOM.scrollTop = nextScrollTop;
      }
    };

    clearActivePreviewCell();
    rootView.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: false,
      userEvent: "select",
    });
    preserveDirectionalScroll();
    rootView.focus();
    preserveDirectionalScroll();
    requestAnimationFrame(() => {
      if (!rootView.dom.isConnected) return;
      rootView.focus();
      rootView.dispatch({
        selection: { anchor: targetPos },
        scrollIntoView: false,
        userEvent: "select",
      });
      preserveDirectionalScroll();
    });
    return true;
  }

  private buildTableDOM(view: EditorView): HTMLTableElement {
    this.editorView = view;

    const tableEl = document.createElement("table");
    const referenceContext = this.createReferenceRenderContext();
    const navigationModel = createTableNavigationModel(this.table);

    const findCell = (address: TableCellAddress): HTMLElement | null => {
      const target = tableEl.querySelector(
        `[data-section="${address.section}"][data-row="${address.row}"][data-col="${address.col}"]`,
      ) as HTMLElement | null;
      return target;
    };

    const focusTargetCell = (address: TableCellAddress): void => {
      const target = findCell(address);
      if (target) {
        setActivePreviewCell(target, this);
      }
    };

    const activateTargetCell = (
      address: TableCellAddress,
      placeAtEnd = false,
    ): void => {
      if (getActiveInlineEditor()) {
        const destroyed = destroyActiveInlineEditor();
        if (!destroyed) return;
        restoreDestroyedInlineEditorLocally(destroyed, this);
      }

      const target = findCell(address);
      if (target) {
        openCellEditor(target, address, { placeAtEnd });
      }
    };

    const addRowAndFocus = (targetCol: number): void => {
      const rootView = this.editorView;
      if (!rootView) return;
      const matchingTable = this.currentTableRange();
      if (matchingTable) {
        applyTableMutation(rootView, matchingTable, (parsed) => addRow(parsed));
      }
      setTimeout(() => {
        const closestEl = findClosestWidgetContainer(rootView, this.tableFrom);
        if (closestEl) {
          const newTarget = closestEl.querySelector(
            `[data-section="body"][data-row="${navigationModel.bodyRowCount}"][data-col="${targetCol}"]`,
          ) as HTMLElement | null;
          if (newTarget) {
            newTarget.dispatchEvent(
              new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
            );
          }
        }
      }, 0);
    };

    const handoffFromActiveEditor = (
      direction: TableBoundaryHandoffDirection,
    ): boolean => {
      const rootView = this.editorView;
      const tableRange = this.currentTableRange();
      const destroyed = destroyActiveInlineEditor();
      if (!destroyed) return true;
      commitDestroyedInlineEditor(destroyed);
      if (rootView && tableRange) {
        destroyed.owner.focusRootOutsideTableWithRange(rootView, tableRange, direction);
      }
      return true;
    };

    const applyCellIntent = (intent: TableCellNavigationIntent): void => {
      if (intent.kind === "handoff") {
        this.focusRootOutsideTable(intent.direction);
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
      }: {
        placeAtEnd?: boolean;
        clickX?: number;
        clickY?: number;
        initialAnchor?: number | null;
        useClickPlacement?: boolean;
      } = {},
    ): void => {
      clearActivePreviewCell();
      const rawText = this.controller.getRawCellText(address);
      cell.innerHTML = "";
      cell.classList.add("cf-table-cell-editing");

      const bibData = this.editorView?.state.field?.(bibDataField, false);
      const referenceCatalog = this.editorView && typeof this.editorView.state.field === "function"
        ? getEditorDocumentReferenceCatalog(this.editorView.state)
        : undefined;
      const controller = createInlineEditorController({
        parent: cell,
        doc: rawText,
        macros: this.macros,
        bibData: bibData ?? undefined,
        referenceCatalog,
        onChange: () => {},
      });

      controller.setCallbacks({
        onChange: (newDoc) => {
          this.syncToRoot(address, newDoc, "edit");
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
            this.editorView?.focus();
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

      setActiveInlineEditor({ controller, view: editorView, cell, owner: this });

      const refocusEditor = (): void => {
        if (getActiveInlineEditor()?.view !== editorView) return;
        editorView.focus();
      };

      const applyInitialSelection = (anchor: number): void => {
        if (getActiveInlineEditor()?.view !== editorView) return;
        editorView.dispatch({ selection: { anchor } });
        editorView.focus();
      };

      if (typeof initialAnchor === "number") {
        applyInitialSelection(initialAnchor);
      } else if (placeAtEnd) {
        const docLen = editorView.state.doc.length;
        applyInitialSelection(docLen);
      }
      refocusEditor();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refocusEditor();
        });
      });

      if (useClickPlacement) {
        requestAnimationFrame(() => {
          if (getActiveInlineEditor()?.view !== editorView) return;
          const point = { x: clickX, y: clickY };
          const precise = preciseHitTestPosition(editorView, point);
          if (precise) {
            applyInitialSelection(precise.pos);
            return;
          }

          const coarse = coarseHitTestPosition(editorView, point);
          if (coarse) {
            applyInitialSelection(coarse.pos);
            return;
          }

          editorView.focus();
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

      const align = this.table.alignments[col];
      if (align && align !== "none") {
        cell.style.textAlign = align;
      }

      this.restoreRenderedCell(cell, content, referenceContext);

      cell.addEventListener("keydown", (event) => {
        if (!isActivePreviewCell(cell, this)) return;

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
          this.editorView?.focus();
          return;
        }

        if (event.key === "ArrowLeft") {
          consumeTableKeyboardEvent(event);
          const intent = moveTableCellHorizontally(navigationModel, address, "left");
          if (intent.kind === "handoff") {
            clearActivePreviewCell();
            this.focusRootOutsideTable(intent.direction);
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
            this.focusRootOutsideTable(intent.direction);
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
            this.focusRootOutsideTable(intent.direction);
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
            this.focusRootOutsideTable(intent.direction);
          } else {
            focusTargetCell(intent.address);
          }
          return;
        }
      });

      cell.addEventListener("blur", () => {
        setTimeout(() => {
          if (!isActivePreviewCell(cell, this)) return;
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
          ? findTableInlineNeutralAnchor(this.controller.getRawCellText(address))
          : null;
        delete cell.dataset.placeAtEnd;

        if (getActiveInlineEditor()) {
          const destroyed = destroyActiveInlineEditor();
          if (destroyed) {
            restoreDestroyedInlineEditorLocally(destroyed, this);
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
    const headerCells = this.table.header.cells;

    for (let col = 0; col < headerCells.length; col++) {
      const th = document.createElement("th");
      setupCell(th, "header", 0, col, headerCells[col].content);
      headerTr.appendChild(th);
    }

    thead.appendChild(headerTr);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (let row = 0; row < this.table.rows.length; row++) {
      const tr = document.createElement("tr");
      const rowCells = this.table.rows[row].cells;

      for (let col = 0; col < rowCells.length; col++) {
        const td = document.createElement("td");
        setupCell(td, "body", row, col, rowCells[col].content);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    tableEl.appendChild(tbody);

    tableEl.addEventListener("contextmenu", (event: MouseEvent) => {
      let target = event.target as HTMLElement | null;
      while (target && target !== tableEl) {
        if (target.dataset.col !== undefined) break;
        target = target.parentElement;
      }
      if (!target || target === tableEl || target.dataset.col === undefined) return;

      event.preventDefault();
      event.stopPropagation();

      const section = target.dataset.section ?? "body";
      const rawRow = parseInt(target.dataset.row ?? "0", 10);
      const rawCol = parseInt(target.dataset.col ?? "0", 10);
      const row = Number.isFinite(rawRow) ? rawRow : 0;
      const col = Number.isFinite(rawCol) ? rawCol : 0;

      const tables = findTablesInState(view.state);
      const tableRange = tables.find((range) => range.from === this.tableFrom);
      if (!tableRange) return;

      showWidgetContextMenu(view, tableRange, section, row, col, event.clientX, event.clientY);
    });

    return tableEl;
  }

  /**
   * Render the parsed table as an HTML <table> with thead/tbody.
   * Each cell gets data attributes for row, column, and section,
   * and inline markdown rendering. Clicking a cell creates an InlineEditor.
   */
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    this.editorView = view;
    this.syncContainerAttrs(container);
    container.appendChild(this.buildTableDOM(view));
    this.bindKeyboardEntry(container);
    this.shellAdapter.observeContainer(container, view);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView, from: TableWidget): boolean {
    if (dom.tagName !== "DIV") return false;

    const canReuseDom = this.eq(from);

    if (canReuseDom) {
      transferTableWidgetSessionOwner(from, this);
      from.shellAdapter.release();
      from.editorView = null;

      this.editorView = view;
      this.syncContainerAttrs(dom);
      this.bindKeyboardEntry(dom);
      this.shellAdapter.observeContainer(dom, view);
      return true;
    }

    destroyInlineEditorForOwner(from);
    clearPreviewCellForOwner(from);
    from.shellAdapter.release();
    from.editorView = null;

    this.editorView = view;
    this.syncContainerAttrs(dom);
    dom.replaceChildren(this.buildTableDOM(view));
    this.bindKeyboardEntry(dom);
    this.shellAdapter.observeContainer(dom, view);
    return true;
  }

  destroy(_dom: HTMLElement): void {
    this.shellAdapter.release();
    destroyInlineEditorForOwner(this);
    clearPreviewCellForOwner(this);
    this.editorView = null;
  }

  /**
   * Estimated height for CM6 scroll calculations.
   * Approximates based on row count: ~32px per row + ~40px header.
   */
  get estimatedHeight(): number {
    const rowCount = this.table.rows.length;
    return 40 + rowCount * 32;
  }
}
