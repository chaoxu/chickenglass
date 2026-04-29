import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
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

function readDatasetNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tableWidgetContainerMatchesRange(
  container: HTMLElement,
  table: TableRange,
): boolean {
  const sourceFrom = readDatasetNumber(container.dataset.sourceFrom);
  const sourceTo = readDatasetNumber(container.dataset.sourceTo);
  if (sourceFrom !== null || sourceTo !== null) {
    return sourceFrom === table.from && sourceTo === table.to;
  }

  return readDatasetNumber(container.dataset.tableFrom) === table.from;
}

function findTableWidgetContainer(
  view: EditorView,
  table: TableRange,
): HTMLElement | null {
  const containers = view.dom.querySelectorAll<HTMLElement>(".cf-table-widget");
  for (const container of containers) {
    if (tableWidgetContainerMatchesRange(container, table)) return container;
  }
  return null;
}

function displayMathTargetFromStop(
  state: EditorState,
  stop: HiddenWidgetStop,
): ReturnType<typeof createStructureEditTargetAt> {
  if (stop.kind !== "display-math") {
    return null;
  }
  const raw = state.doc.sliceString(stop.from, stop.to);
  const openerLength = raw.startsWith("\\[") ? 2 : raw.startsWith("$$") ? 2 : 0;
  const closer = raw.startsWith("\\[") ? "\\]" : "$$";
  const closeIndex = raw.lastIndexOf(closer);
  const contentFrom = stop.contentFrom ?? stop.from + openerLength;
  const contentTo = stop.contentTo ??
    (
      closeIndex > openerLength
        ? stop.from + closeIndex
        : stop.to
    );
  return {
    kind: "display-math",
    from: stop.from,
    to: stop.to,
    contentFrom,
    contentTo: Math.max(contentFrom, contentTo),
  };
}

export function activateTableStop(
  view: EditorView,
  table: TableRange,
  forward: boolean,
): number {
  const enterTable = (): boolean => {
    const container = findTableWidgetContainer(view, table);
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
  landedHead?: number,
): number | null {
  const lineForStop = view.state.doc.lineAt(stop.from).number;
  const targetPos = forward ? stop.from : Math.max(stop.from, stop.to - 1);
  const target = createStructureEditTargetAt(view.state, targetPos) ??
    (() => {
      if (stop.kind !== "display-math") return null;
      const contentLineNumber = Math.min(stop.endLine, stop.startLine + 1);
      const contentLine = view.state.doc.line(contentLineNumber);
      const candidates = [
        stop.from,
        Math.max(stop.from, stop.to - 1),
        Math.floor((stop.from + stop.to) / 2),
        contentLine.from,
      ];
      for (const candidate of candidates) {
        const resolved = createStructureEditTargetAt(view.state, candidate);
        if (resolved?.kind === "display-math") return resolved;
      }
      return displayMathTargetFromStop(view.state, stop);
    })();

  if (target?.kind === "display-math") {
    const anchor = landedHead === undefined
      ? forward ? target.contentFrom : target.contentTo
      : Math.max(
        target.contentFrom,
        Math.min(landedHead, target.contentTo),
      );
    if (!activateStructureEditTarget(view, target, anchor)) return null;
    return view.state.doc.lineAt(anchor).number;
  }
  if (target && landedHead !== undefined) {
    const anchor = Math.max(
      stop.from,
      Math.min(landedHead, Math.max(stop.from, stop.to - 1)),
    );
    if (!activateStructureEditTarget(view, target, anchor)) return null;
    return view.state.doc.lineAt(anchor).number;
  }
  if (target && activateStructureEditAt(view, targetPos)) {
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  if (stop.kind === "block-image" && landedHead !== undefined) {
    const targetLineNumber = forward
      ? Math.min(view.state.doc.lines, stop.endLine + 1)
      : Math.max(1, stop.startLine - 1);
    const targetLine = view.state.doc.line(targetLineNumber);
    const imageExitPos = forward ? targetLine.from : targetLine.to;
    view.dispatch({
      selection: EditorSelection.cursor(imageExitPos, forward ? 1 : -1),
      scrollIntoView: false,
      userEvent: "select",
    });
    return targetLineNumber;
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
