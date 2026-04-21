import type { EditorView } from "@codemirror/view";
import type { InlineEditorController } from "../inline-editor";
import type { TableRange } from "./table-discovery";
import type { TableBoundaryHandoffDirection } from "./table-widget-navigation";

export interface TableWidgetSessionOwner {
  applyLocalCellEdit(cell: HTMLElement, content: string): void;
  commitRenderedCell(cell: HTMLElement, content: string): void;
  focusRootOutsideTable(direction: TableBoundaryHandoffDirection): boolean;
  focusRootOutsideTableWithRange(
    rootView: EditorView,
    tableRange: TableRange,
    direction: TableBoundaryHandoffDirection,
  ): boolean;
}

export interface ActiveInlineEditor {
  readonly controller: InlineEditorController;
  readonly view: EditorView;
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
}

export interface DestroyedInlineEditor {
  readonly text: string;
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
  readonly controller: InlineEditorController;
}

interface ActivePreviewCell {
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
}

let activeInlineEditor: ActiveInlineEditor | null = null;
let activePreviewCell: ActivePreviewCell | null = null;

export function getActiveInlineEditor(): ActiveInlineEditor | null {
  return activeInlineEditor;
}

export function setActiveInlineEditor(editor: ActiveInlineEditor): void {
  activeInlineEditor = editor;
}

export function isActiveInlineCell(cell: HTMLElement): boolean {
  return activeInlineEditor?.cell === cell;
}

export function destroyActiveInlineEditor(): DestroyedInlineEditor | null {
  if (!activeInlineEditor) return null;
  const { controller, view: inlineView, cell, owner } = activeInlineEditor;
  const text = inlineView.state.doc.toString();
  cell.classList.remove("cf-table-cell-editing");
  controller.destroy();
  cell.innerHTML = "";
  activeInlineEditor = null;
  return { text, cell, owner, controller };
}

export function commitDestroyedInlineEditor(destroyed: DestroyedInlineEditor): void {
  destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
}

export function restoreDestroyedInlineEditorLocally(
  destroyed: DestroyedInlineEditor,
  fallbackOwner: TableWidgetSessionOwner,
): void {
  if (destroyed.owner === fallbackOwner) {
    destroyed.owner.applyLocalCellEdit(destroyed.cell, destroyed.text);
    return;
  }
  destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
}

export function clearActivePreviewCell(): void {
  if (!activePreviewCell) return;
  activePreviewCell.cell.classList.remove("cf-table-cell-active");
  activePreviewCell.cell.removeAttribute("tabindex");
  activePreviewCell = null;
}

export function setActivePreviewCell(
  cell: HTMLElement,
  owner: TableWidgetSessionOwner,
): void {
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

export function isActivePreviewCell(
  cell: HTMLElement,
  owner: TableWidgetSessionOwner,
): boolean {
  return activePreviewCell?.cell === cell && activePreviewCell.owner === owner;
}

export function shouldCommitBlurredInlineEditor(
  snapshot: ActiveInlineEditor | null,
  current: ActiveInlineEditor | null,
  cell: HTMLElement,
): snapshot is ActiveInlineEditor {
  return snapshot !== null && current === snapshot && snapshot.cell === cell;
}

export function transferTableWidgetSessionOwner(
  from: TableWidgetSessionOwner,
  to: TableWidgetSessionOwner,
): void {
  if (activeInlineEditor?.owner === from) {
    activeInlineEditor = {
      ...activeInlineEditor,
      owner: to,
    };
  }
  if (activePreviewCell?.owner === from) {
    activePreviewCell = {
      ...activePreviewCell,
      owner: to,
    };
  }
}

export function destroyInlineEditorForOwner(owner: TableWidgetSessionOwner): void {
  if (activeInlineEditor?.owner === owner) {
    destroyActiveInlineEditor();
  }
}

export function clearPreviewCellForOwner(owner: TableWidgetSessionOwner): void {
  if (activePreviewCell?.owner === owner) {
    clearActivePreviewCell();
  }
}
