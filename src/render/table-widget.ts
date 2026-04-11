import { Annotation } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createInlineEditorController,
  type InlineEditorController,
} from "../inline-editor";
import {
  findInlineNeutralAnchor,
  parseInlineFragments,
} from "../inline-fragments";
import { renderInlineMarkdown } from "./inline-render";
import { showWidgetContextMenu, applyTableMutation } from "./table-actions";
import {
  findClosestTable,
  findClosestWidgetContainer,
  findTablesInState,
} from "./table-discovery";
import { addRow, formatTable, type ParsedTable } from "./table-utils";
import { requestScrollStabilizedMeasure } from "./scroll-anchor";
import { isReferenceWidgetTarget } from "./reference-widget";
import {
  syncActiveFenceGuideClasses,
} from "./source-widget";
import { ShellWidget } from "./shell-widget";
import { bibDataField } from "../state/bib-data";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";

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

interface ActiveInlineEditor {
  controller: InlineEditorController;
  view: EditorView;
  cell: HTMLElement;
  owner: TableWidget;
}

interface DestroyedInlineEditor {
  text: string;
  cell: HTMLElement;
  owner: TableWidget;
  controller: InlineEditorController;
}

/** Module-level reference to the currently active inline cell editor. */
let activeInlineEditor: ActiveInlineEditor | null = null;

interface ActivePreviewCell {
  cell: HTMLElement;
  owner: TableWidget;
}

let activePreviewCell: ActivePreviewCell | null = null;

export function shouldCommitBlurredInlineEditor(
  snapshot: typeof activeInlineEditor,
  current: typeof activeInlineEditor,
  cell: HTMLElement,
): snapshot is NonNullable<typeof activeInlineEditor> {
  return snapshot !== null && current === snapshot && snapshot.cell === cell;
}

export function serializeTableWidgetMacros(macros: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(macros).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Destroy the currently active inline editor (if any) and return
 * the final document text from that editor.
 */
function destroyActiveInlineEditor(): DestroyedInlineEditor | null {
  if (!activeInlineEditor) return null;
  const { controller, view: inlineView, cell, owner } = activeInlineEditor;
  const text = inlineView.state.doc.toString();
  cell.classList.remove("cf-table-cell-editing");
  controller.destroy();
  cell.innerHTML = "";
  activeInlineEditor = null;
  return { text, cell, owner, controller };
}

function clearActivePreviewCell(): void {
  if (!activePreviewCell) return;
  activePreviewCell.cell.classList.remove("cf-table-cell-active");
  activePreviewCell.cell.removeAttribute("tabindex");
  activePreviewCell = null;
}

function setActivePreviewCell(cell: HTMLElement, owner: TableWidget): void {
  if (activePreviewCell?.cell === cell && activePreviewCell.owner === owner) {
    cell.focus();
    return;
  }
  clearActivePreviewCell();
  cell.classList.add("cf-table-cell-active");
  cell.tabIndex = -1;
  cell.focus();
  activePreviewCell = { cell, owner };
}

function isRenderedInlineTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isReferenceWidgetTarget(target)) return true;
  return Boolean(
    target.closest(
      [
        ".katex",
        ".cross-ref",
        ".cf-link-rendered",
        ".cf-inline-code",
        ".cf-highlight",
        ".cf-bold",
        ".cf-italic",
        ".cf-strikethrough",
        "strong",
        "em",
        "del",
        "mark",
        "code",
      ].join(", "),
    ),
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
export class TableWidget extends ShellWidget {
  /** Reference to the EditorView, stored on first toDOM() call. */
  private editorView: EditorView | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeMeasureFrame: number | null = null;
  private readonly previewEditors = new Map<HTMLElement, InlineEditorController>();
  private readonly macroSignature: string;
  private readonly renderSignature: string;

  constructor(
    private readonly table: ParsedTable,
    private readonly tableText: string,
    private tableFrom: number,
    private readonly macros: Record<string, string>,
    renderSignature = "",
  ) {
    super();
    this.macroSignature = serializeTableWidgetMacros(macros);
    this.renderSignature = renderSignature;
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

  /**
   * Return the raw markdown text for a cell given its section and indices.
   */
  private getRawCellText(section: string, row: number, col: number): string {
    if (section === "header") {
      return col < this.table.header.cells.length
        ? this.table.header.cells[col].content
        : "";
    }
    if (row < this.table.rows.length && col < this.table.rows[row].cells.length) {
      return this.table.rows[row].cells[col].content;
    }
    return "";
  }

  /**
   * Build a new ParsedTable with one cell replaced.
   */
  private buildUpdatedTable(
    section: string,
    row: number,
    col: number,
    newContent: string,
  ): ParsedTable {
    if (section === "header") {
      const cells = this.table.header.cells.map((cell, index) =>
        index === col ? { content: newContent } : cell,
      );
      return { ...this.table, header: { cells } };
    }
    const rows = this.table.rows.map((tableRow, rowIndex) => {
      if (rowIndex !== row) return tableRow;
      const cells = tableRow.cells.map((cell, colIndex) =>
        colIndex === col ? { content: newContent } : cell,
      );
      return { cells };
    });
    return { ...this.table, rows };
  }

  private getCellPosition(cell: HTMLElement): {
    section: string;
    row: number;
    col: number;
  } {
    const rawRow = parseInt(cell.dataset.row ?? "0", 10);
    const rawCol = parseInt(cell.dataset.col ?? "0", 10);
    return {
      section: cell.dataset.section ?? "body",
      row: Number.isFinite(rawRow) ? rawRow : 0,
      col: Number.isFinite(rawCol) ? rawCol : 0,
    };
  }

  private restoreRenderedCell(cell: HTMLElement, content: string): void {
    this.destroyPreviewEditor(cell);
    if (this.cellNeedsLivePreview(content)) {
      this.mountPreviewEditor(cell, content);
      return;
    }
    renderInlineMarkdown(cell, content, this.macros);
  }

  private cellNeedsLivePreview(content: string): boolean {
    return parseInlineFragments(content).some((fragment) => fragment.kind === "reference");
  }

  private getReferenceCatalog() {
    const state = this.editorView?.state as { field?: unknown } | undefined;
    return state && typeof state.field === "function"
      ? getEditorDocumentReferenceCatalog(this.editorView!.state)
      : undefined;
  }

  private mountPreviewEditor(cell: HTMLElement, content: string): void {
    const bibData = this.editorView?.state.field?.(bibDataField, false);
    const referenceCatalog = this.getReferenceCatalog();
    const controller = createInlineEditorController({
      parent: cell,
      doc: content,
      macros: this.macros,
      bibData: bibData ?? undefined,
      referenceCatalog,
      readOnly: true,
      onChange: () => {},
    });
    this.previewEditors.set(cell, controller);
  }

  private destroyPreviewEditor(cell: HTMLElement): void {
    const controller = this.previewEditors.get(cell);
    if (!controller) return;
    controller.destroy();
    this.previewEditors.delete(cell);
    cell.innerHTML = "";
  }

  private destroyPreviewEditors(): void {
    for (const [cell, controller] of this.previewEditors) {
      controller.destroy();
      cell.innerHTML = "";
    }
    this.previewEditors.clear();
  }

  private syncToRoot(
    editedSection: string,
    editedRow: number,
    editedCol: number,
    editedText: string,
    annotation: "edit" | "commit",
  ): void {
    const rootView = this.editorView;
    if (!rootView) return;
    const currentTables = findTablesInState(rootView.state);
    const bestTable = findClosestTable(currentTables, this.tableFrom);
    if (!bestTable) return;
    this.tableFrom = bestTable.from;
    const currentText = rootView.state.sliceDoc(bestTable.from, bestTable.to);
    const updated = this.buildUpdatedTable(editedSection, editedRow, editedCol, editedText);
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

  private commitRenderedCell(
    cell: HTMLElement,
    content: string,
  ): void {
    this.restoreRenderedCell(cell, content);
    const { section, row, col } = this.getCellPosition(cell);
    this.syncToRoot(section, row, col, content, "commit");
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

  private clearPendingResizeMeasure(): void {
    if (this.resizeMeasureFrame !== null) {
      cancelAnimationFrame(this.resizeMeasureFrame);
      this.resizeMeasureFrame = null;
    }
  }

  private observeContainer(container: HTMLElement, view: EditorView): void {
    this.clearPendingResizeMeasure();
    this.resizeObserver?.disconnect();

    if (typeof ResizeObserver === "undefined") {
      this.resizeObserver = null;
      return;
    }

    let isFirstCallback = true;
    this.resizeObserver = new ResizeObserver(() => {
      if (isFirstCallback) {
        isFirstCallback = false;
        return;
      }
      if (this.resizeMeasureFrame !== null) return;
      this.resizeMeasureFrame = requestAnimationFrame(() => {
        this.resizeMeasureFrame = null;
        requestScrollStabilizedMeasure(view);
      });
    });
    this.resizeObserver.observe(container);
  }

  private buildTableDOM(view: EditorView): HTMLTableElement {
    this.editorView = view;

    const tableEl = document.createElement("table");

    const focusTargetCell = (
      linearRow: number,
      targetCol: number,
    ): void => {
      const targetSection = linearRow === 0 ? "header" : "body";
      const targetRow = linearRow === 0 ? 0 : linearRow - 1;
      const target = tableEl.querySelector(
        `[data-section="${targetSection}"][data-row="${targetRow}"][data-col="${targetCol}"]`,
      ) as HTMLElement | null;
      if (target) {
        setActivePreviewCell(target, this);
      }
    };

    const activateTargetCell = (
      linearRow: number,
      targetCol: number,
      placeAtEnd = false,
    ): void => {
      const targetSection = linearRow === 0 ? "header" : "body";
      const targetRow = linearRow === 0 ? 0 : linearRow - 1;
      const target = tableEl.querySelector(
        `[data-section="${targetSection}"][data-row="${targetRow}"][data-col="${targetCol}"]`,
      ) as HTMLElement | null;
      if (target) {
        target.dataset.placeAtEnd = placeAtEnd ? "true" : "false";
        target.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      }
    };

    const openCellEditor = (
      cell: HTMLElement,
      section: string,
      row: number,
      col: number,
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
      const rawText = this.getRawCellText(section, row, col);
      this.destroyPreviewEditor(cell);
      cell.innerHTML = "";
      cell.classList.add("cf-table-cell-editing");

      const colCount = this.table.header.cells.length;
      const bodyRowCount = this.table.rows.length;
      const currentLinear = section === "header" ? 0 : row + 1;
      const totalRows = 1 + bodyRowCount;
      const bibData = this.editorView?.state.field?.(bibDataField, false);
      const referenceCatalog = this.getReferenceCatalog();
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
          this.syncToRoot(section, row, col, newDoc, "edit");
        },
        onBlur: () => {
          const blurredEditor = activeInlineEditor;
          setTimeout(() => {
            if (!shouldCommitBlurredInlineEditor(blurredEditor, activeInlineEditor, cell)) return;
            const destroyed = destroyActiveInlineEditor();
            if (!destroyed) return;

            destroyed.owner.commitRenderedCell(
              destroyed.cell,
              destroyed.text,
            );
          }, 0);
        },
        onKeydown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            const destroyed = destroyActiveInlineEditor();
            if (!destroyed) return true;
            destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
            this.editorView?.focus();
            return true;
          }

          if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            let nextCol = col + 1;
            let nextLinear = currentLinear;
            if (nextCol >= colCount) {
              nextCol = 0;
              nextLinear++;
            }
            if (nextLinear >= totalRows) {
              const destroyed = destroyActiveInlineEditor();
              if (!destroyed) return true;
              destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
              const rootView = this.editorView;
              if (rootView) {
                const tables = findTablesInState(rootView.state);
                const matchingTable = findClosestTable(tables, this.tableFrom);
                if (matchingTable) {
                  applyTableMutation(rootView, matchingTable, (parsed) => addRow(parsed));
                }
                setTimeout(() => {
                  const closestEl = findClosestWidgetContainer(rootView, this.tableFrom);
                  if (closestEl) {
                    const newTarget = closestEl.querySelector(
                      `[data-section="body"][data-row="${bodyRowCount}"][data-col="0"]`,
                    ) as HTMLElement | null;
                    if (newTarget) {
                      newTarget.dispatchEvent(
                        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
                      );
                    }
                  }
                }, 0);
              }
            } else {
              activateTargetCell(nextLinear, nextCol);
            }
            return true;
          }

          if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            let prevCol = col - 1;
            let prevLinear = currentLinear;
            if (prevCol < 0) {
              prevCol = colCount - 1;
              prevLinear--;
            }
            if (prevLinear < 0) return true;
            activateTargetCell(prevLinear, prevCol, true);
            return true;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            const nextLinear = currentLinear + 1;
            if (nextLinear >= totalRows) {
              const destroyed = destroyActiveInlineEditor();
              if (!destroyed) return true;
              destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
              const rootView = this.editorView;
              if (rootView) {
                const tables = findTablesInState(rootView.state);
                const matchingTable = findClosestTable(tables, this.tableFrom);
                if (matchingTable) {
                  applyTableMutation(rootView, matchingTable, (parsed) => addRow(parsed));
                }
                setTimeout(() => {
                  const closestEl = findClosestWidgetContainer(rootView, this.tableFrom);
                  if (closestEl) {
                    const newTarget = closestEl.querySelector(
                      `[data-section="body"][data-row="${bodyRowCount}"][data-col="${col}"]`,
                    ) as HTMLElement | null;
                    if (newTarget) {
                      newTarget.dispatchEvent(
                        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
                      );
                    }
                  }
                }, 0);
              }
            } else {
              activateTargetCell(nextLinear, col);
            }
            return true;
          }

          if (!activeInlineEditor) return false;
          const pos = activeInlineEditor.view.state.selection.main.head;
          const len = activeInlineEditor.view.state.doc.length;

          if (event.key === "ArrowLeft" && pos === 0) {
            event.preventDefault();
            let prevCol = col - 1;
            let prevLinear = currentLinear;
            if (prevCol < 0) {
              prevCol = colCount - 1;
              prevLinear--;
            }
            if (prevLinear < 0) return true;
            activateTargetCell(prevLinear, prevCol, true);
            return true;
          }

          if (event.key === "ArrowRight" && pos === len) {
            event.preventDefault();
            let nextCol = col + 1;
            let nextLinear = currentLinear;
            if (nextCol >= colCount) {
              nextCol = 0;
              nextLinear++;
            }
            if (nextLinear >= totalRows) return true;
            activateTargetCell(nextLinear, nextCol);
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            const prevLinear = currentLinear - 1;
            if (prevLinear < 0) return true;
            activateTargetCell(prevLinear, col);
            return true;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextLinear = currentLinear + 1;
            if (nextLinear >= totalRows) return true;
            activateTargetCell(nextLinear, col);
            return true;
          }

          if (event.key === "Backspace" && pos === 0) return true;
          if (event.key === "Delete" && pos === len) return true;

          return false;
        },
      });
      const editorView = controller.view;

      activeInlineEditor = { controller, view: editorView, cell, owner: this };

      const applyInitialSelection = (anchor: number): void => {
        if (activeInlineEditor?.view !== editorView) return;
        editorView.dispatch({ selection: { anchor } });
        editorView.focus();
      };

      if (typeof initialAnchor === "number") {
        applyInitialSelection(initialAnchor);
      } else if (placeAtEnd) {
        const docLen = editorView.state.doc.length;
        applyInitialSelection(docLen);
      }
      editorView.focus();

      if (useClickPlacement) {
        requestAnimationFrame(() => {
          if (activeInlineEditor?.view !== editorView) return;
          const pos = editorView.posAtCoords({ x: clickX, y: clickY });
          if (pos !== null) {
            applyInitialSelection(pos);
            return;
          }

          const coarsePos = editorView.posAtCoords({ x: clickX, y: clickY }, false);
          if (coarsePos !== null) {
            applyInitialSelection(coarsePos);
            return;
          }

          editorView.focus();
        });
      }
    };

    const setupCell = (
      cell: HTMLElement,
      section: string,
      row: number,
      col: number,
      content: string,
    ): void => {
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.dataset.section = section;

      const align = this.table.alignments[col];
      if (align && align !== "none") {
        cell.style.textAlign = align;
      }

      this.restoreRenderedCell(cell, content);

      cell.addEventListener("keydown", (event) => {
        if (activePreviewCell?.cell !== cell || activePreviewCell.owner !== this) return;

        const currentLinear = section === "header" ? 0 : row + 1;

        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          openCellEditor(cell, section, row, col);
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          clearActivePreviewCell();
          this.editorView?.focus();
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          const prevCol = col - 1;
          if (prevCol >= 0) focusTargetCell(currentLinear, prevCol);
          return;
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          const nextCol = col + 1;
          if (nextCol < this.table.header.cells.length) focusTargetCell(currentLinear, nextCol);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const prevLinear = currentLinear - 1;
          if (prevLinear >= 0) focusTargetCell(prevLinear, col);
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextLinear = currentLinear + 1;
          if (nextLinear < 1 + this.table.rows.length) focusTargetCell(nextLinear, col);
          return;
        }
      });

      cell.addEventListener("blur", () => {
        setTimeout(() => {
          if (activePreviewCell?.cell !== cell || activePreviewCell.owner !== this) return;
          if (document.activeElement === cell) return;
          clearActivePreviewCell();
        }, 0);
      });

      cell.addEventListener("mousedown", (event) => {
        try {
        if (activeInlineEditor && activeInlineEditor.cell === cell) return;

        event.preventDefault();
        event.stopPropagation();

        const clickX = event.clientX;
        const clickY = event.clientY;
        const placeAtEnd = cell.dataset.placeAtEnd === "true";
        const clickedRenderedToken = isRenderedInlineTarget(event.target);
        const initialAnchor = clickedRenderedToken
          ? findInlineNeutralAnchor(this.getRawCellText(section, row, col))
          : null;
        delete cell.dataset.placeAtEnd;

        if (activeInlineEditor) {
          const destroyed = destroyActiveInlineEditor();
          if (destroyed) {
            destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
          }
        }

        openCellEditor(cell, section, row, col, {
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
        if (activeInlineEditor?.cell === cell) return;
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
    this.observeContainer(container, view);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView, from: TableWidget): boolean {
    if (dom.tagName !== "DIV") return false;

    if (activeInlineEditor?.owner === from) {
      destroyActiveInlineEditor();
    }
    if (activePreviewCell?.owner === from) {
      clearActivePreviewCell();
    }
    from.destroyPreviewEditors();
    from.clearPendingResizeMeasure();
    from.resizeObserver?.disconnect();
    from.resizeObserver = null;
    from.editorView = null;

    this.editorView = view;
    this.syncContainerAttrs(dom);
    dom.replaceChildren(this.buildTableDOM(view));
    this.observeContainer(dom, view);
    return true;
  }

  destroy(_dom: HTMLElement): void {
    this.clearPendingResizeMeasure();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (activeInlineEditor?.owner === this) {
      destroyActiveInlineEditor();
    }
    if (activePreviewCell?.owner === this) {
      clearActivePreviewCell();
    }
    this.destroyPreviewEditors();
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
