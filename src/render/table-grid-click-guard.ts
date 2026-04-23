import { EditorView } from "@codemirror/view";
import { preciseHitTestPosition } from "../lib/editor-hit-test";
import { containsPos } from "../lib/range-helpers";
import { getCellBounds } from "./table-cell-geometry";
import { findPipePositions } from "./table-discovery";

// ---------------------------------------------------------------------------
// Click guard — clamp click position to cell content bounds (#617)
//
// In CSS grid table rows, `posAtCoords` (via caretPositionFromPoint) can
// return positions outside the clicked cell's content: it may land on the
// wrong row entirely (cross-row drift in the last column) or in the
// leading/trailing atomic-range whitespace, which renders visually at the
// start of the next row. We use posAtDOM on the `.cf-grid-cell` element to
// identify the correct cell, then clamp the result to the trimmed content
// bounds [cell.from, cell.to].
// ---------------------------------------------------------------------------

/**
 * If the click lands outside the cell's content bounds — either on a
 * different row (browser caretPositionFromPoint cross-row misresolution,
 * common in the last column of CSS-grid tables) or in the leading/trailing
 * whitespace area that maps to an atomic range — return the clamped position
 * at the end of the cell's trimmed content. Returns `null` when `posAtCoords`
 * already resolved within the cell content bounds.
 */
export function guardTableGridMousePosition(
  view: EditorView,
  event: MouseEvent,
): number | null {
  const target = event.target;
  if (!(target instanceof HTMLElement || target instanceof Text)) return null;

  const el = target instanceof HTMLElement ? target : target.parentElement;
  if (!el) return null;

  const gridCell = el.closest(".cf-grid-cell");
  if (!(gridCell instanceof HTMLElement)) return null;

  const cellLine = view.state.doc.lineAt(view.posAtDOM(gridCell, 0));
  const parsedCol = Number.parseInt(gridCell.dataset.col ?? "0", 10);
  const col = Number.isFinite(parsedCol) ? parsedCol : 0;
  const pipes = findPipePositions(cellLine.text);
  const cell = getCellBounds(cellLine, pipes).find((candidate) => candidate.col === col);
  if (!cell) return null;

  const pos = preciseHitTestPosition(view, { x: event.clientX, y: event.clientY })?.pos ?? null;
  if (pos !== null && containsPos(cell, pos)) return null;

  return cell.to;
}

export const tableGridClickGuard = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView) {
    if (
      event.button !== 0 ||
      event.detail > 1 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return false;
    }

    const corrected = guardTableGridMousePosition(view, event);
    if (corrected === null) return false;

    event.preventDefault();
    view.dispatch({
      selection: { anchor: corrected },
      scrollIntoView: false,
    });
    view.focus();
    return true;
  },
});
