import { EditorSelection } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { getLineElement } from "../render/render-core";
import { appendDebugTimelineEvent } from "./debug-timeline";
import {
  activateStructureEditAt,
  activateStructureEditTarget,
  createStructureEditTargetAt,
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

function isRenderedLineVisible(
  view: EditorView,
  lineNumber: number,
): boolean {
  const height = measuredLineHeight(view, lineNumber);
  return height !== null && height > 0;
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

function startCoordsForVerticalMove(
  view: EditorView,
  forward: boolean,
): { left: number; top: number; bottom: number } | null {
  const range = view.state.selection.main;
  return safeCoordsAtPos(
    view,
    range.head,
    range.assoc || ((range.empty ? forward : range.head === range.from) ? 1 : -1),
  );
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

function goalColumnForVerticalMove(
  view: EditorView,
  forward: boolean,
): number {
  const range = view.state.selection.main;
  if (range.goalColumn != null) return range.goalColumn;
  const rect = view.contentDOM.getBoundingClientRect();
  const coords = startCoordsForVerticalMove(view, forward);
  if (coords) return coords.left - rect.left;

  const line = view.lineBlockAt(range.head);
  return Math.min(
    rect.right - rect.left,
    view.defaultCharacterWidth * (range.head - line.from),
  );
}

function nextVisibleLineNumber(
  view: EditorView,
  fromLine: number,
  forward: boolean,
): number | null {
  const direction = forward ? 1 : -1;
  const currentVisible = isRenderedLineVisible(view, fromLine);
  for (
    let line = fromLine + (currentVisible ? direction : 0);
    line >= 1 && line <= view.state.doc.lines;
    line += direction
  ) {
    if (line === fromLine && currentVisible) continue;
    if (isRenderedLineVisible(view, line)) return line;
  }
  return null;
}

interface HiddenWidgetStop {
  readonly from: number;
  readonly to: number;
  readonly element: HTMLElement;
}

function parseWidgetSourcePos(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function firstHiddenWidgetStopBetweenLines(
  view: EditorView,
  fromLine: number,
  nextVisibleLine: number,
  forward: boolean,
): HiddenWidgetStop | null {
  const hiddenLineStart = Math.min(fromLine, nextVisibleLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, nextVisibleLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const seen = new Set<string>();
  const candidates: Array<HiddenWidgetStop & {
    readonly startLine: number;
    readonly endLine: number;
  }> = [];

  for (const el of view.contentDOM.querySelectorAll<HTMLElement>("[data-source-from][data-source-to]")) {
    const from = parseWidgetSourcePos(el.dataset.sourceFrom);
    const to = parseWidgetSourcePos(el.dataset.sourceTo);
    if (from === null || to === null || from < 0 || to < from) continue;

    const endPos = to > from ? to - 1 : from;
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(endPos).number;
    if (endLine < hiddenLineStart || startLine > hiddenLineEnd) continue;

    const key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ from, to, startLine, endLine, element: el });
  }

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (forward) {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      if (left.from !== right.from) return left.from - right.from;
      return left.to - right.to;
    }
    if (left.endLine !== right.endLine) return right.endLine - left.endLine;
    if (left.to !== right.to) return right.to - left.to;
    return right.from - left.from;
  });

  const candidate = candidates[0];
  return {
    from: candidate.from,
    to: candidate.to,
    element: candidate.element,
  };
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

function closestPositionOnLine(
  view: EditorView,
  lineNumber: number,
  goalX: number,
): number {
  const line = view.state.doc.line(lineNumber);
  if (line.length === 0) return line.from;

  let low = line.from;
  let high = line.to;
  let best = line.from;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const coords = safeCoordsAtPos(view, mid, 1) ?? safeCoordsAtPos(view, mid, -1);
    if (!coords) break;
    if (coords.left <= goalX + 0.5) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function resolveVisibleLineTarget(
  view: EditorView,
  targetLineNumber: number,
  goalX: number,
): number {
  const targetLine = view.state.doc.line(targetLineNumber);
  if (targetLine.length === 0) return targetLine.from;

  return closestPositionOnLine(view, targetLineNumber, goalX);
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

export function moveVerticallyInRichView(
  view: EditorView,
  forward: boolean,
): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;

  const before = snapshotVerticalMotion(view);
  const goalColumn = goalColumnForVerticalMove(view, forward);
  const nextVisibleLine = nextVisibleLineNumber(view, before.line, forward);

  if (nextVisibleLine === null) {
    // Consume the key at rich-mode boundaries so CM6's default ArrowUp/Down
    // handler does not run a second vertical move with different assoc/goal
    // state and bounce between the terminal blank line and the last content line.
    return true;
  }

  const goalX = view.contentDOM.getBoundingClientRect().left + goalColumn;
  const hiddenWidgetStop = firstHiddenWidgetStopBetweenLines(
    view,
    before.line,
    nextVisibleLine,
    forward,
  );
  if (hiddenWidgetStop) {
    const correctedTargetLine = activateHiddenWidgetStop(view, hiddenWidgetStop, forward);
    if (correctedTargetLine !== null) {
      recordVerticalMotionGuardEvent(view, {
        kind: "visible-line-jump",
        direction: forward ? "down" : "up",
        beforeLine: before.line,
        rawTargetLine: nextVisibleLine,
        correctedTargetLine,
        timestamp: Date.now(),
      });
      requestSelectionVisibility(view);
      return true;
    }
  }

  const targetPos = resolveVisibleLineTarget(view, nextVisibleLine, goalX);

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, forward ? 1 : -1, undefined, goalColumn),
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
