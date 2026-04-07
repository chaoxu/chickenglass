import { EditorSelection } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { getLineElement } from "../render/render-core";
import { appendDebugTimelineEvent } from "./debug-timeline";

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

export type VerticalMotionGuardEvent =
  | {
      readonly kind: "visible-line-jump";
      readonly direction: "up" | "down";
      readonly beforeLine: number;
      readonly rawTargetLine: number;
      readonly correctedTargetLine: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "reverse-scroll";
      readonly direction: "up" | "down";
      readonly beforeLine: number;
      readonly afterLine: number;
      readonly beforeScrollTop: number;
      readonly afterScrollTop: number;
      readonly correctedScrollTop: number;
      readonly timestamp: number;
    };

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

export function correctedVisibleLineJump(
  fromLine: number,
  toLine: number,
  isLineVisible: (lineNumber: number) => boolean,
): number | null {
  if (fromLine === toLine) return null;

  const direction = Math.sign(toLine - fromLine);
  for (
    let line = fromLine + direction;
    direction > 0 ? line < toLine : line > toLine;
    line += direction
  ) {
    if (isLineVisible(line)) {
      return line;
    }
  }

  return null;
}

function startCoordsForVerticalMove(
  view: EditorView,
  forward: boolean,
): { left: number; top: number; bottom: number } | null {
  const range = view.state.selection.main;
  return view.coordsAtPos(
    range.head,
    range.assoc || ((range.empty ? forward : range.head === range.from) ? 1 : -1),
  );
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

function targetLineMidpointY(
  view: EditorView,
  lineNumber: number,
): number | null {
  const line = view.state.doc.line(lineNumber);
  const probePos = line.length === 0 ? line.from : Math.min(line.to, line.from + 1);
  const coords = view.coordsAtPos(probePos, 1) ?? view.coordsAtPos(probePos, -1);
  if (!coords) return null;
  return (coords.top + coords.bottom) / 2;
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
    const coords = view.coordsAtPos(mid, 1) ?? view.coordsAtPos(mid, -1);
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

  const targetY = targetLineMidpointY(view, targetLineNumber);
  if (targetY != null) {
    const resolved = view.posAtCoords({ x: goalX, y: targetY }, false);
    if (resolved != null && view.state.doc.lineAt(resolved).number === targetLineNumber) {
      return resolved;
    }
  }

  return closestPositionOnLine(view, targetLineNumber, goalX);
}

export function moveVerticallyWithReverseScrollGuard(
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
  const targetPos = resolveVisibleLineTarget(view, nextVisibleLine, goalX);

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, forward ? 1 : -1, undefined, goalColumn),
    scrollIntoView: true,
    userEvent: "select",
  });

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
