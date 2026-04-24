import type { EditorView } from "@codemirror/view";
import { showWidgetContextMenu, applyTableMutation } from "./table-actions";
import {
  findClosestWidgetContainer,
  findTablesInState,
  type TableRange,
} from "./table-discovery";
import { addRow } from "./table-utils";

export interface AppendTableWidgetRowOptions {
  readonly rootView: EditorView;
  readonly tableRange: TableRange | null;
  readonly tableFrom: number;
  readonly bodyRowCount: number;
  readonly targetCol: number;
}

export function appendTableWidgetRowAndFocus({
  rootView,
  tableRange,
  tableFrom,
  bodyRowCount,
  targetCol,
}: AppendTableWidgetRowOptions): void {
  if (tableRange) {
    applyTableMutation(rootView, tableRange, (parsed) => addRow(parsed));
  }
  setTimeout(() => {
    const closestEl = findClosestWidgetContainer(rootView, tableFrom);
    if (!closestEl) return;

    const newTarget = closestEl.querySelector(
      `[data-section="body"][data-row="${bodyRowCount}"][data-col="${targetCol}"]`,
    ) as HTMLElement | null;
    if (!newTarget) return;

    newTarget.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  }, 0);
}

export function showTableWidgetContextMenu(
  view: EditorView,
  tableFrom: number,
  tableEl: HTMLTableElement,
  event: MouseEvent,
): void {
  let target = event.target as HTMLElement | null;
  while (target && target !== tableEl) {
    if (target.dataset.col !== undefined) break;
    target = target.parentElement;
  }
  if (!target || target === tableEl || target.dataset.col === undefined) return;

  event.preventDefault();
  event.stopPropagation();

  const section = target.dataset.section ?? "body";
  const rawRow = Number.parseInt(target.dataset.row ?? "0", 10);
  const rawCol = Number.parseInt(target.dataset.col ?? "0", 10);
  const row = Number.isFinite(rawRow) ? rawRow : 0;
  const col = Number.isFinite(rawCol) ? rawCol : 0;

  const tables = findTablesInState(view.state);
  const tableRange = tables.find((range) => range.from === tableFrom);
  if (!tableRange) return;

  showWidgetContextMenu(view, tableRange, section, row, col, event.clientX, event.clientY);
}
