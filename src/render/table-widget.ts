import { EditorView } from "@codemirror/view";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
import type { InlineReferenceRenderContext } from "./inline-render";
import type { TableRange } from "./table-discovery";
import type { ParsedTable } from "./table-utils";
import {
  syncActiveFenceGuideClasses,
} from "./source-widget";
import { ShellWidget } from "./shell-widget";
import {
  cellEditAnnotation,
  TableWidgetController,
} from "./table-widget-controller";
import { focusRootOutsideTableWithRange } from "./table-widget-focus";
import {
  bindTableKeyboardEntry,
  type TableKeyboardEntryController,
} from "./table-widget-keyboard-entry";
import {
  clearPreviewCellForOwner,
  destroyActiveInlineEditor,
  destroyInlineEditorForOwner,
  getActiveInlineEditor,
  setActivePreviewCell,
  shouldCommitBlurredInlineEditor,
  transferTableWidgetSessionOwner,
  type TableWidgetSessionOwner,
} from "./table-widget-session";
import { restoreRenderedTableCell } from "./table-widget-preview";
import {
  readTableCellAddress,
  type TableBoundaryHandoffDirection,
  type TableCellAddress,
} from "./table-widget-navigation";
import { TableWidgetShellAdapter } from "./table-widget-shell-adapter";
import { getOptionalReferenceRenderState } from "../state/reference-render-state";
import {
  createEditorReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
} from "../references/presentation";
import { buildTableWidgetDOM } from "./table-widget-dom";

export { cellEditAnnotation, shouldCommitBlurredInlineEditor };

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
export class TableWidget extends ShellWidget implements
  TableKeyboardEntryController,
  TableWidgetSessionOwner {
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
    container.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.tableBlock,
      "cf-table-widget",
    );
    container.dataset.tableTextHash = this.tableText;
    container.dataset.tableFrom = String(this.tableFrom);
    this.syncWidgetAttrs(container, this.editorView ?? undefined);
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

  enterPreviewCellFromKeyboard(
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
    bindTableKeyboardEntry(container, this);
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
    return focusRootOutsideTableWithRange(rootView, tableRange, direction);
  }

  private buildTableDOM(view: EditorView): HTMLTableElement {
    this.editorView = view;
    return buildTableWidgetDOM({
      view,
      owner: this,
      table: this.table,
      tableFrom: this.tableFrom,
      macros: this.macros,
      referenceContext: this.createReferenceRenderContext(),
      getRootView: () => this.editorView,
      currentTableRange: () => this.currentTableRange(),
      getRawCellText: (address) => this.controller.getRawCellText(address),
      restoreRenderedCell: (cell, content, referenceContext) => {
        this.restoreRenderedCell(cell, content, referenceContext);
      },
      syncToRoot: (address, editedText, annotation) => {
        this.syncToRoot(address, editedText, annotation);
      },
    });
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
