import { EditorSelection, type SelectionRange } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { type TableRange } from "../state/table-discovery";
import {
  activateStructureEditAt,
  activateStructureEditTarget,
  clearStructureEditTarget,
  createStructureEditTargetAt,
  getActiveStructureEditTarget,
} from "../state/cm-structure-edit";
import { dispatchWidgetKeyboardEntry } from "../state/widget-keyboard-entry";
import { type HiddenWidgetStop } from "./widget-stop-index";
import { requestSelectionVisibility } from "./vertical-motion-scroll";

function findClosestTableWidgetContainer(
  view: EditorView,
  trackedFrom: number,
): HTMLElement | null {
  const containers = view.dom.querySelectorAll<HTMLElement>(".cf-table-widget");
  let closest: HTMLElement | null = null;
  let closestDist = Infinity;
  for (const container of containers) {
    const parsed = Number.parseInt(container.dataset.tableFrom ?? "0", 10);
    const tableFrom = Number.isFinite(parsed) ? parsed : 0;
    const dist = Math.abs(tableFrom - trackedFrom);
    if (dist < closestDist) {
      closestDist = dist;
      closest = container;
    }
  }
  return closest;
}

export function activateTableStop(
  view: EditorView,
  table: TableRange,
  forward: boolean,
): number {
  const enterTable = (): boolean => {
    const container = findClosestTableWidgetContainer(view, table.from);
    if (!container) return false;
    return dispatchWidgetKeyboardEntry(container, {
      direction: forward ? "down" : "up",
      sourceFrom: table.from,
      sourceTo: table.to,
    });
  };

  if (!enterTable()) {
    const targetPos = forward ? table.from : Math.max(table.from, table.to - 1);
    view.dispatch({
      selection: EditorSelection.cursor(targetPos, forward ? 1 : -1),
      scrollIntoView: false,
      userEvent: "select",
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        enterTable();
      });
    });
  }

  return forward
    ? table.startLineNumber
    : view.state.doc.lineAt(Math.max(table.from, table.to - 1)).number;
}

export function activateHiddenWidgetStop(
  view: EditorView,
  stop: HiddenWidgetStop,
  forward: boolean,
): number | null {
  const lineForStop = view.state.doc.lineAt(stop.from).number;
  const targetPos = forward ? stop.from : Math.max(stop.from, stop.to - 1);
  const target = createStructureEditTargetAt(view.state, targetPos);

  if (target?.kind === "display-math") {
    const anchor = forward ? target.contentFrom : target.contentTo;
    if (!activateStructureEditTarget(view, target, anchor)) return null;
    return view.state.doc.lineAt(anchor).number;
  }
  if (target && activateStructureEditAt(view, targetPos)) {
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, forward ? 1 : -1),
    scrollIntoView: false,
    userEvent: "select",
  });
  return lineForStop;
}

export function exitActiveDisplayMathTarget(
  view: EditorView,
  forward: boolean,
  baselineScrollTop: number,
): boolean {
  const active = getActiveStructureEditTarget(view.state);
  if (active?.kind !== "display-math") return false;

  const exitPos = forward ? active.to : active.from;
  if (!clearStructureEditTarget(view)) return false;
  view.dispatch({
    selection: EditorSelection.cursor(exitPos, forward ? 1 : -1),
    scrollIntoView: false,
    userEvent: "select",
  });
  requestSelectionVisibility(view, forward ? "down" : "up", baselineScrollTop);
  return true;
}

export function displayMathExitRange(
  active: Extract<ReturnType<typeof getActiveStructureEditTarget>, { kind: "display-math" }>,
  forward: boolean,
): SelectionRange {
  const exitPos = forward ? active.to : active.from;
  return EditorSelection.cursor(exitPos, forward ? 1 : -1);
}
