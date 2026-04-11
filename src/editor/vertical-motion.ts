import { EditorSelection } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { getLineElement } from "../render/render-core";
import { type TableRange } from "../state/table-discovery";
import { findTablesInState } from "../state/table-discovery";
import { appendDebugTimelineEvent } from "./debug-timeline";
import {
  activateStructureEditAt,
  activateStructureEditTarget,
  clearStructureEditTarget,
  createStructureEditTargetAt,
  getActiveStructureEditTarget,
} from "./structure-edit-state";

const FALLBACK_LINE_HEIGHT_PX = 24;
const REVERSE_SCROLL_THRESHOLD_PX = 120;
const MAX_GUARD_EVENTS = 20;
const pendingReverseScrollGuardIds = new WeakMap<EditorView, number>();
const verticalMotionGuardEvents = new WeakMap<EditorView, VerticalMotionGuardEvent[]>();
let nextReverseScrollGuardId = 0;

interface VerticalMotionSnapshot {
  readonly head: number;
  readonly line: number;
  readonly scrollTop: number;
}

interface BaseVerticalMotionGuardEvent {
  readonly direction: "up" | "down";
  readonly beforeLine: number;
  readonly timestamp: number;
}

export type VerticalMotionGuardEvent =
  | (BaseVerticalMotionGuardEvent & {
      readonly kind: "visible-line-jump";
      readonly rawTargetLine: number;
      readonly correctedTargetLine: number;
    })
  | (BaseVerticalMotionGuardEvent & {
      readonly kind: "reverse-scroll";
      readonly afterLine: number;
      readonly beforeScrollTop: number;
      readonly afterScrollTop: number;
      readonly correctedScrollTop: number;
    });

export function recordVerticalMotionGuardEvent(
  view: EditorView,
  event: VerticalMotionGuardEvent,
): void {
  const currentEvents = verticalMotionGuardEvents.get(view) ?? [];
  const nextEvents = [...currentEvents, event];
  if (nextEvents.length > MAX_GUARD_EVENTS) {
    nextEvents.splice(0, nextEvents.length - MAX_GUARD_EVENTS);
  }
  verticalMotionGuardEvents.set(view, nextEvents);
  appendDebugTimelineEvent(view, {
    timestamp: event.timestamp,
    type: "motion-guard",
    summary: event.kind === "visible-line-jump"
      ? `${event.direction} L${event.beforeLine} -> raw L${event.rawTargetLine} -> L${event.correctedTargetLine}`
      : `${event.direction} L${event.beforeLine} -> L${event.afterLine}, scroll ${Math.round(event.beforeScrollTop)} -> ${Math.round(event.afterScrollTop)} -> ${Math.round(event.correctedScrollTop)}`,
    detail: event,
  });
}

export function getVerticalMotionGuardEvents(
  view: EditorView,
): readonly VerticalMotionGuardEvent[] {
  return verticalMotionGuardEvents.get(view) ?? [];
}

export function clearVerticalMotionGuardEvents(
  view: EditorView,
): void {
  verticalMotionGuardEvents.delete(view);
}

function snapshotVerticalMotion(view: EditorView): VerticalMotionSnapshot {
  const head = view.state.selection.main.head;
  return {
    head,
    line: view.state.doc.lineAt(head).number,
    scrollTop: view.scrollDOM.scrollTop,
  };
}

function measuredLineHeight(
  view: EditorView,
  lineNumber: number,
): number | null {
  const lineEl = getLineElement(view, view.state.doc.line(lineNumber).from);
  if (!lineEl) return null;

  const height = Number.parseFloat(window.getComputedStyle(lineEl).height);
  return Number.isFinite(height) && height >= 0 ? height : null;
}

function readLineHeight(
  view: EditorView,
  lineNumber: number,
): number {
  return measuredLineHeight(view, lineNumber) ?? FALLBACK_LINE_HEIGHT_PX;
}

export function sumTraversedLineHeights(
  fromLine: number,
  toLine: number,
  getLineHeight: (lineNumber: number) => number,
): number {
  if (fromLine === toLine) return 0;

  let total = 0;
  if (toLine < fromLine) {
    for (let line = toLine; line < fromLine; line += 1) {
      total += getLineHeight(line);
    }
    return total;
  }

  for (let line = fromLine; line < toLine; line += 1) {
    total += getLineHeight(line);
  }
  return total;
}

export function correctedReverseVerticalScrollTop(
  before: VerticalMotionSnapshot,
  after: VerticalMotionSnapshot,
  traversedHeight: number,
): number | null {
  const lineDelta = after.line - before.line;
  const headDelta = after.head - before.head;
  const scrollDelta = after.scrollTop - before.scrollTop;
  const movedUp = lineDelta < 0 || headDelta < 0;
  const movedDown = lineDelta > 0 || headDelta > 0;

  if (movedUp && scrollDelta >= REVERSE_SCROLL_THRESHOLD_PX) {
    return Math.max(0, before.scrollTop - traversedHeight);
  }
  if (movedDown && scrollDelta <= -REVERSE_SCROLL_THRESHOLD_PX) {
    return before.scrollTop + traversedHeight;
  }
  return null;
}

function safeCoordsAtPos(
  view: EditorView,
  pos: number,
  assoc?: 1 | -1,
): { left: number; right: number; top: number; bottom: number } | null {
  try {
    return view.coordsAtPos(pos, assoc);
  } catch {
    return null;
  }
}

interface HiddenWidgetStop {
  readonly from: number;
  readonly to: number;
  readonly element: HTMLElement;
}

interface HiddenWidgetStopCandidate extends HiddenWidgetStop {
  readonly startLine: number;
  readonly endLine: number;
}

interface TableStopCandidate {
  readonly table: TableRange;
  readonly startLine: number;
  readonly endLine: number;
}

function parseWidgetSourcePos(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function collectHiddenWidgetStopCandidates(
  view: EditorView,
): HiddenWidgetStopCandidate[] {
  const seen = new Set<string>();
  const candidates: HiddenWidgetStopCandidate[] = [];

  for (const el of view.contentDOM.querySelectorAll<HTMLElement>("[data-source-from][data-source-to]")) {
    const from = parseWidgetSourcePos(el.dataset.sourceFrom);
    const to = parseWidgetSourcePos(el.dataset.sourceTo);
    if (from === null || to === null || from < 0 || to < from) continue;

    const endPos = to > from ? to - 1 : from;
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(endPos).number;

    const key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ from, to, startLine, endLine, element: el });
  }

  return candidates;
}

function firstHiddenWidgetStopBetweenLines(
  candidates: readonly HiddenWidgetStopCandidate[],
  fromLine: number,
  targetLine: number,
  forward: boolean,
): HiddenWidgetStop | null {
  const hiddenLineStart = Math.min(fromLine, targetLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, targetLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const matching = candidates.filter((candidate) =>
    candidate.endLine >= hiddenLineStart && candidate.startLine <= hiddenLineEnd
  );
  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    if (forward) {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      if (left.from !== right.from) return left.from - right.from;
      return left.to - right.to;
    }
    if (left.endLine !== right.endLine) return right.endLine - left.endLine;
    if (left.to !== right.to) return right.to - left.to;
    return right.from - left.from;
  });

  const candidate = matching[0];
  return {
    from: candidate.from,
    to: candidate.to,
    element: candidate.element,
  };
}

function hiddenWidgetStopAtPos(
  candidates: readonly HiddenWidgetStopCandidate[],
  pos: number,
): HiddenWidgetStop | null {
  const matching = candidates.filter((candidate) =>
    pos >= candidate.from && (candidate.to === candidate.from ? pos === candidate.to : pos < candidate.to)
  );
  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    const leftSpan = left.to - left.from;
    const rightSpan = right.to - right.from;
    return leftSpan - rightSpan || left.from - right.from;
  });
  const candidate = matching[0];
  return {
    from: candidate.from,
    to: candidate.to,
    element: candidate.element,
  };
}

function collectTableStopCandidates(
  view: EditorView,
): TableStopCandidate[] {
  return findTablesInState(view.state).map((table) => ({
    table,
    startLine: table.startLineNumber,
    endLine: view.state.doc.lineAt(Math.max(table.from, table.to - 1)).number,
  }));
}

function firstTableStopBetweenLines(
  candidates: readonly TableStopCandidate[],
  fromLine: number,
  targetLine: number,
  forward: boolean,
): TableRange | null {
  const hiddenLineStart = Math.min(fromLine, targetLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, targetLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const matching = candidates.filter((candidate) =>
    candidate.endLine >= hiddenLineStart && candidate.startLine <= hiddenLineEnd
  );
  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    if (forward) {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      return left.table.from - right.table.from;
    }
    if (left.endLine !== right.endLine) return right.endLine - left.endLine;
    return right.table.to - left.table.to;
  });

  return matching[0].table;
}

function tableStopAtPos(
  candidates: readonly TableStopCandidate[],
  pos: number,
): TableRange | null {
  const matching = candidates.filter((candidate) =>
    pos >= candidate.table.from && pos < candidate.table.to
  );
  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    const leftSpan = left.table.to - left.table.from;
    const rightSpan = right.table.to - right.table.from;
    return leftSpan - rightSpan || left.table.from - right.table.from;
  });
  return matching[0].table;
}

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

function activateTableStop(
  view: EditorView,
  table: TableRange,
): number {
  const openFirstCell = (): boolean => {
    const container = findClosestTableWidgetContainer(view, table.from);
    const firstCell = container?.querySelector<HTMLElement>(
      '[data-section="header"][data-row="0"][data-col="0"], [data-section][data-row][data-col]',
    );
    if (!firstCell) return false;
    dispatchPlainMouseDown(firstCell);
    return Boolean(
      container?.querySelector(`.${CSS.tableCellEditing} .cm-editor`) ||
      (container !== null &&
        document.activeElement instanceof HTMLElement &&
        container.contains(document.activeElement))
    );
  };

  if (!openFirstCell()) {
    view.dispatch({
      selection: EditorSelection.cursor(table.from, 1),
      scrollIntoView: true,
      userEvent: "select",
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        openFirstCell();
      });
    });
  }

  return table.startLineNumber;
}

function dispatchPlainMouseDown(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    view: window,
  }));
}

function activateHiddenWidgetStop(
  view: EditorView,
  stop: HiddenWidgetStop,
  forward: boolean,
): number | null {
  const selectionBefore = view.state.selection.main;
  const lineForStop = view.state.doc.lineAt(stop.from).number;

  if (stop.element.classList.contains(CSS.tableWidget)) {
    const firstCell = stop.element.querySelector<HTMLElement>("[data-section][data-row][data-col]");
    if (firstCell) {
      dispatchPlainMouseDown(firstCell);
      const selectionAfter = view.state.selection.main;
      if (
        selectionAfter.from !== selectionBefore.from ||
        selectionAfter.to !== selectionBefore.to
      ) {
        return view.state.doc.lineAt(selectionAfter.head).number;
      }
      if (
        stop.element.querySelector(`.${CSS.tableCellEditing} .cm-editor`) ||
        (document.activeElement instanceof HTMLElement && stop.element.contains(document.activeElement))
      ) {
        return lineForStop;
      }
    }
  } else {
    const mouseTarget = stop.element.classList.contains(CSS.mathDisplay)
      ? stop.element.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`) ?? stop.element
      : stop.element;
    dispatchPlainMouseDown(mouseTarget);
    const selectionAfter = view.state.selection.main;
    if (
      selectionAfter.from !== selectionBefore.from ||
      selectionAfter.to !== selectionBefore.to
    ) {
      return view.state.doc.lineAt(selectionAfter.head).number;
    }
    if (
      document.activeElement instanceof HTMLElement &&
      stop.element.contains(document.activeElement)
    ) {
      return lineForStop;
    }
  }

  const targetPos = forward ? stop.from : Math.max(stop.from, stop.to - 1);
  const target = createStructureEditTargetAt(view.state, targetPos);
  if (target?.kind === "display-math") {
    const anchor = forward ? target.contentFrom : target.contentTo;
    if (!activateStructureEditTarget(view, target, anchor)) return null;
    return view.state.doc.lineAt(anchor).number;
  }
  if (activateStructureEditAt(view, targetPos)) {
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, forward ? 1 : -1),
    scrollIntoView: false,
    userEvent: "select",
  });
  return lineForStop;
}

function requestSelectionVisibility(
  view: EditorView,
): void {
  if (!view.dom.isConnected) return;
  const selectionAssoc: 1 | -1 = view.state.selection.main.assoc === -1
    ? -1
    : 1;

  view.requestMeasure({
    read: () => {
      const coords = safeCoordsAtPos(view, view.state.selection.main.head, selectionAssoc);
      if (!coords) return null;
      const scrollerRect = view.scrollDOM.getBoundingClientRect();
      return {
        coords,
        scrollerTop: scrollerRect.top,
        scrollerBottom: scrollerRect.bottom,
        scrollTop: view.scrollDOM.scrollTop,
        viewportHeight: view.scrollDOM.clientHeight,
      };
    },
    write: (measurement) => {
      if (!measurement) return;
      const margin = Math.min(64, measurement.viewportHeight / 5);
      let nextScrollTop = measurement.scrollTop;
      if (measurement.coords.top < measurement.scrollerTop + margin) {
        nextScrollTop += measurement.coords.top - (measurement.scrollerTop + margin);
      } else if (measurement.coords.bottom > measurement.scrollerBottom - margin) {
        nextScrollTop += measurement.coords.bottom - (measurement.scrollerBottom - margin);
      }
      const clampedScrollTop = Math.max(0, nextScrollTop);
      if (clampedScrollTop !== measurement.scrollTop) {
        view.scrollDOM.scrollTop = clampedScrollTop;
      }
    },
  });
}

function exitActiveDisplayMathTarget(
  view: EditorView,
  forward: boolean,
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
  requestSelectionVisibility(view);
  return true;
}

export function moveVerticallyInRichView(
  view: EditorView,
  forward: boolean,
): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const activeStructure = getActiveStructureEditTarget(view.state);

  const before = snapshotVerticalMotion(view);
  const nextRange = view.moveVertically(range, forward);

  if (
    nextRange.anchor === range.anchor &&
    nextRange.head === range.head
  ) {
    if (exitActiveDisplayMathTarget(view, forward)) {
      return true;
    }
    // Consume the key at rich-mode boundaries so CM6's default ArrowUp/Down
    // handler does not run a second vertical move with different assoc/goal
    // state and bounce between the terminal blank line and the last content line.
    return true;
  }

  if (activeStructure?.kind === "display-math") {
    const nextInsideActiveDisplayMath =
      nextRange.head >= activeStructure.from && nextRange.head < activeStructure.to;

    if (!nextInsideActiveDisplayMath) {
      clearStructureEditTarget(view);
    }

    view.dispatch({
      selection: view.state.selection.replaceRange(nextRange),
      scrollIntoView: false,
      userEvent: "select",
    });
    requestSelectionVisibility(view);
    return true;
  }

  const rawTargetLine = view.state.doc.lineAt(nextRange.head).number;
  const hiddenWidgetStops = collectHiddenWidgetStopCandidates(view);
  const tableStops = collectTableStopCandidates(view);
  const hiddenWidgetStop = firstHiddenWidgetStopBetweenLines(
    hiddenWidgetStops,
    before.line,
    rawTargetLine,
    forward,
  );
  if (hiddenWidgetStop) {
    const correctedTargetLine = activateHiddenWidgetStop(view, hiddenWidgetStop, forward);
    if (correctedTargetLine !== null) {
      recordVerticalMotionGuardEvent(view, {
        kind: "visible-line-jump",
        direction: forward ? "down" : "up",
        beforeLine: before.line,
        rawTargetLine,
        correctedTargetLine,
        timestamp: Date.now(),
      });
      requestSelectionVisibility(view);
      return true;
    }
  }

  const crossedTableStop = firstTableStopBetweenLines(
    tableStops,
    before.line,
    rawTargetLine,
    forward,
  );
  if (crossedTableStop) {
    const correctedTargetLine = activateTableStop(view, crossedTableStop);
    recordVerticalMotionGuardEvent(view, {
      kind: "visible-line-jump",
      direction: forward ? "down" : "up",
      beforeLine: before.line,
      rawTargetLine,
      correctedTargetLine,
      timestamp: Date.now(),
    });
    return true;
  }

  const landedWidgetStop = hiddenWidgetStopAtPos(hiddenWidgetStops, nextRange.head);
  if (landedWidgetStop) {
    const correctedTargetLine = activateHiddenWidgetStop(view, landedWidgetStop, forward);
    if (correctedTargetLine !== null) {
      recordVerticalMotionGuardEvent(view, {
        kind: "visible-line-jump",
        direction: forward ? "down" : "up",
        beforeLine: before.line,
        rawTargetLine,
        correctedTargetLine,
        timestamp: Date.now(),
      });
      requestSelectionVisibility(view);
      return true;
    }
  }

  const landedTableStop = tableStopAtPos(tableStops, nextRange.head);
  if (landedTableStop) {
    const correctedTargetLine = activateTableStop(view, landedTableStop);
    recordVerticalMotionGuardEvent(view, {
      kind: "visible-line-jump",
      direction: forward ? "down" : "up",
      beforeLine: before.line,
      rawTargetLine,
      correctedTargetLine,
      timestamp: Date.now(),
    });
    return true;
  }

  if (activateStructureEditAt(view, nextRange.head)) {
    requestSelectionVisibility(view);
    return true;
  }

  view.dispatch({
    selection: view.state.selection.replaceRange(nextRange),
    scrollIntoView: false,
    userEvent: "select",
  });
  requestSelectionVisibility(view);

  const guardId = ++nextReverseScrollGuardId;
  pendingReverseScrollGuardIds.set(view, guardId);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      if (pendingReverseScrollGuardIds.get(view) !== guardId) return;

      const after = snapshotVerticalMotion(view);
      const traversedHeight = sumTraversedLineHeights(
        before.line,
        after.line,
        (lineNumber) => readLineHeight(view, lineNumber),
      );
      const correctedScrollTop = correctedReverseVerticalScrollTop(
        before,
        after,
        traversedHeight,
      );
      if (correctedScrollTop !== null && correctedScrollTop !== view.scrollDOM.scrollTop) {
        recordVerticalMotionGuardEvent(view, {
          kind: "reverse-scroll",
          direction: forward ? "down" : "up",
          beforeLine: before.line,
          afterLine: after.line,
          beforeScrollTop: before.scrollTop,
          afterScrollTop: after.scrollTop,
          correctedScrollTop,
          timestamp: Date.now(),
        });
      }
    });
  });

  return true;
}
