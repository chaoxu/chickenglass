import { EditorSelection, type SelectionRange } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { getLineElement } from "../render/render-core";
import { documentAnalysisField } from "../state/document-analysis";
import { type TableRange } from "../state/table-discovery";
import { appendDebugTimelineEvent } from "./debug-timeline";
import {
  activateStructureEditAt,
  activateStructureEditTarget,
  clearStructureEditTarget,
  createStructureEditTargetAt,
  getActiveStructureEditTarget,
  structureEditTargetContainsPos,
} from "../state/cm-structure-edit";
import { dispatchWidgetKeyboardEntry } from "../state/widget-keyboard-entry";
import {
  type HiddenWidgetStop,
  firstHiddenWidgetStopBetweenLines,
  firstTableStopBetweenLines,
  getWidgetStopIndex,
  hiddenWidgetStopAtPos,
  tableStopAtPos,
} from "./widget-stop-index";

const FALLBACK_LINE_HEIGHT_PX = 24;
const REVERSE_SCROLL_JITTER_PX = 8;
const MAX_DIRECTIONAL_SCROLL_STEP_PX = 144;
const SUSPICIOUS_STRUCTURE_EXIT_LINE_DELTA = 25;
const MAX_GUARD_EVENTS = 20;
const REVERSE_SCROLL_CORRECTION_ATTEMPTS = 6;
const REVERSE_SCROLL_CORRECTION_DELAYS_MS = [0, 8, 16, 24, 30, 40, 48, 72, 96] as const;
const activeReverseScrollGuards = new WeakMap<EditorView, ReverseScrollGuard>();
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

interface ReverseScrollGuard {
  readonly id: number;
  readonly direction: "up" | "down";
  enforcedScrollTop: number;
  boundedScrollTop: number;
  removeScrollListener: (() => void) | null;
  timeoutId: number | null;
}

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

function hasReversedVerticalDirection(
  beforeLine: number,
  targetLine: number,
  forward: boolean,
): boolean {
  return forward ? targetLine < beforeLine : targetLine > beforeLine;
}

function fallbackVerticalCursor(
  view: EditorView,
  lineNumber: number,
  forward: boolean,
): SelectionRange {
  const targetLineNumber = forward
    ? Math.min(view.state.doc.lines, lineNumber + 1)
    : Math.max(1, lineNumber - 1);
  const targetLine = view.state.doc.line(targetLineNumber);
  return EditorSelection.cursor(
    forward ? targetLine.from : targetLine.to,
    forward ? 1 : -1,
  );
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

  if (movedUp && scrollDelta > REVERSE_SCROLL_JITTER_PX) {
    return Math.max(0, before.scrollTop - traversedHeight);
  }
  if (movedDown && scrollDelta < -REVERSE_SCROLL_JITTER_PX) {
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
  } catch (_error) {
    return null;
  }
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

function activateDisplayMathStopBetweenLines(
  view: EditorView,
  fromLine: number,
  targetLine: number,
  forward: boolean,
): number | null {
  const hiddenLineStart = Math.min(fromLine, targetLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, targetLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const analysis = view.state.field(documentAnalysisField, false);
  if (!analysis) return null;

  const matching = analysis.mathRegions
    .filter((region) => region.isDisplay)
    .map((region) => ({
      region,
      startLine: view.state.doc.lineAt(region.from).number,
      endLine: view.state.doc.lineAt(region.to).number,
    }))
    .filter((candidate) =>
      candidate.endLine >= hiddenLineStart && candidate.startLine <= hiddenLineEnd
    );

  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    if (forward) {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      return left.region.from - right.region.from;
    }
    if (left.endLine !== right.endLine) return right.endLine - left.endLine;
    return right.region.to - left.region.to;
  });

  const chosen = matching[0]?.region;
  if (!chosen) return null;

  const probePos = forward ? chosen.contentFrom : chosen.contentTo;
  const target = createStructureEditTargetAt(view.state, probePos);
  if (target?.kind !== "display-math") return null;

  const anchor = forward ? target.contentFrom : target.contentTo;
  if (!activateStructureEditTarget(view, target, anchor)) return null;
  return view.state.doc.lineAt(anchor).number;
}

function activateHiddenWidgetStop(
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

  if (dispatchWidgetKeyboardEntry(stop.element, {
    direction: forward ? "down" : "up",
    sourceFrom: stop.from,
    sourceTo: stop.to,
  })) {
    return lineForStop;
  }

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, forward ? 1 : -1),
    scrollIntoView: false,
    userEvent: "select",
  });
  return lineForStop;
}

function maxDirectionalScrollStep(viewportHeight: number): number {
  return Math.max(
    FALLBACK_LINE_HEIGHT_PX * 4,
    Math.min(MAX_DIRECTIONAL_SCROLL_STEP_PX, viewportHeight / 4),
  );
}

export function boundedDirectionalScrollTop(
  scrollTop: number,
  baselineScrollTop: number,
  direction: "up" | "down",
  viewportHeight: number,
): number {
  const maxStep = maxDirectionalScrollStep(viewportHeight);
  if (direction === "down") {
    return Math.max(
      baselineScrollTop,
      Math.min(scrollTop, baselineScrollTop + maxStep),
    );
  }
  return Math.min(
    baselineScrollTop,
    Math.max(scrollTop, baselineScrollTop - maxStep),
  );
}

function requestSelectionVisibility(
  view: EditorView,
  direction?: "up" | "down",
  baselineScrollTop?: number,
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
      const monotonicScrollTop = direction === "down"
        ? Math.max(measurement.scrollTop, clampedScrollTop)
        : direction === "up"
        ? Math.min(measurement.scrollTop, clampedScrollTop)
        : clampedScrollTop;
      const boundedScrollTop = direction && baselineScrollTop !== undefined
        ? boundedDirectionalScrollTop(
          monotonicScrollTop,
          baselineScrollTop,
          direction,
          measurement.viewportHeight,
        )
        : monotonicScrollTop;
      if (boundedScrollTop !== measurement.scrollTop) {
        view.scrollDOM.scrollTop = boundedScrollTop;
      }
    },
  });
}

function preserveDirectionalScrollTop(
  view: EditorView,
  baselineScrollTop: number,
  forward: boolean,
): void {
  const currentScrollTop = view.scrollDOM.scrollTop;
  const correctedScrollTop = forward
    ? Math.max(currentScrollTop, baselineScrollTop)
    : Math.min(currentScrollTop, baselineScrollTop);
  if (correctedScrollTop !== currentScrollTop) {
    view.scrollDOM.scrollTop = correctedScrollTop;
  }
}

function exitActiveDisplayMathTarget(
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

function displayMathExitRange(
  active: Extract<ReturnType<typeof getActiveStructureEditTarget>, { kind: "display-math" }>,
  forward: boolean,
): SelectionRange {
  const exitPos = forward ? active.to : active.from;
  return EditorSelection.cursor(exitPos, forward ? 1 : -1);
}

function scheduleReverseScrollGuard(
  view: EditorView,
  before: VerticalMotionSnapshot,
  forward: boolean,
): void {
  const direction: "up" | "down" = forward ? "down" : "up";
  const directionalStep = maxDirectionalScrollStep(view.scrollDOM.clientHeight);
  const initialBoundedScrollTop = forward
    ? before.scrollTop + directionalStep
    : Math.max(0, before.scrollTop - directionalStep);
  const clampToGuard = (
    scrollTop: number,
    guard: ReverseScrollGuard,
  ): number => {
    if (forward) {
      return Math.min(
        guard.boundedScrollTop,
        Math.max(scrollTop, guard.enforcedScrollTop),
      );
    }
    return Math.max(
      guard.boundedScrollTop,
      Math.min(scrollTop, guard.enforcedScrollTop),
    );
  };
  let guard = activeReverseScrollGuards.get(view);
  if (!guard || guard.direction !== direction) {
    const previousGuard = guard;
    if (previousGuard && previousGuard.timeoutId !== null) {
      window.clearTimeout(previousGuard.timeoutId);
    }
    previousGuard?.removeScrollListener?.();
    guard = {
      id: ++nextReverseScrollGuardId,
      direction,
      enforcedScrollTop: before.scrollTop,
      boundedScrollTop: initialBoundedScrollTop,
      removeScrollListener: null,
      timeoutId: null,
    };
    const createdGuard = guard;
    const onScroll = (): void => {
      if (!view.dom.isConnected) {
        createdGuard.removeScrollListener?.();
        activeReverseScrollGuards.delete(view);
        return;
      }
      const currentGuard = activeReverseScrollGuards.get(view);
      if (currentGuard !== createdGuard) {
        createdGuard.removeScrollListener?.();
        return;
      }
      const currentScrollTop = view.scrollDOM.scrollTop;
      const correctedScrollTop = clampToGuard(currentScrollTop, currentGuard);
      const needsCorrection = Math.abs(correctedScrollTop - currentScrollTop) >
        REVERSE_SCROLL_JITTER_PX;
      if (needsCorrection) {
        view.scrollDOM.scrollTop = correctedScrollTop;
      }
    };
    guard.removeScrollListener = () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    activeReverseScrollGuards.set(view, guard);
  } else {
    guard.enforcedScrollTop = forward
      ? Math.max(guard.enforcedScrollTop, before.scrollTop)
      : Math.min(guard.enforcedScrollTop, before.scrollTop);
    guard.boundedScrollTop = initialBoundedScrollTop;
  }

  if (guard.timeoutId !== null) {
    window.clearTimeout(guard.timeoutId);
  }
  guard.timeoutId = window.setTimeout(() => {
    const currentGuard = activeReverseScrollGuards.get(view);
    if (currentGuard !== guard) return;
    currentGuard.removeScrollListener?.();
    activeReverseScrollGuards.delete(view);
  }, 200);

  const guardId = guard.id;
  const enforceCorrectedScrollTop = (correctedScrollTop: number): void => {
    if (!view.dom.isConnected) return;
    const currentGuard = activeReverseScrollGuards.get(view);
    if (currentGuard?.id !== guardId) return;

    const currentScrollTop = view.scrollDOM.scrollTop;
    const boundedCorrectedScrollTop = clampToGuard(correctedScrollTop, currentGuard);
    const nextScrollTop = clampToGuard(currentScrollTop, currentGuard);
    const needsCorrection = Math.abs(nextScrollTop - currentScrollTop) >
        REVERSE_SCROLL_JITTER_PX ||
      (forward
        ? currentScrollTop < boundedCorrectedScrollTop - REVERSE_SCROLL_JITTER_PX
        : currentScrollTop > boundedCorrectedScrollTop + REVERSE_SCROLL_JITTER_PX);

    if (needsCorrection) {
      view.scrollDOM.scrollTop = forward
        ? Math.max(nextScrollTop, boundedCorrectedScrollTop)
        : Math.min(nextScrollTop, boundedCorrectedScrollTop);
    }
  };

  const scheduleCorrectedScrollTopAttempts = (correctedScrollTop: number): void => {
    enforceCorrectedScrollTop(correctedScrollTop);

    let frameAttemptsRemaining = REVERSE_SCROLL_CORRECTION_ATTEMPTS;
    const enforceOnFrame = (): void => {
      enforceCorrectedScrollTop(correctedScrollTop);
      frameAttemptsRemaining -= 1;
      if (frameAttemptsRemaining > 0) {
        requestAnimationFrame(enforceOnFrame);
      }
    };
    requestAnimationFrame(() => {
      enforceOnFrame();
    });

    for (const delay of REVERSE_SCROLL_CORRECTION_DELAYS_MS) {
      window.setTimeout(() => {
        enforceCorrectedScrollTop(correctedScrollTop);
      }, delay);
    }
  };

  scheduleCorrectedScrollTopAttempts(guard.enforcedScrollTop);

  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;
    const currentGuard = activeReverseScrollGuards.get(view);
    if (!currentGuard || currentGuard.id !== guardId) return;

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
      currentGuard.enforcedScrollTop = forward
        ? Math.max(currentGuard.enforcedScrollTop, correctedScrollTop)
        : Math.min(currentGuard.enforcedScrollTop, correctedScrollTop);
      currentGuard.boundedScrollTop = forward
        ? Math.max(currentGuard.boundedScrollTop, currentGuard.enforcedScrollTop)
        : Math.min(currentGuard.boundedScrollTop, currentGuard.enforcedScrollTop);
      view.scrollDOM.scrollTop = currentGuard.enforcedScrollTop;
      scheduleCorrectedScrollTopAttempts(currentGuard.enforcedScrollTop);
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
    if (exitActiveDisplayMathTarget(view, forward, before.scrollTop)) {
      scheduleReverseScrollGuard(view, before, forward);
      return true;
    }
    // Consume the key at rich-mode boundaries so CM6's default ArrowUp/Down
    // handler does not run a second vertical move with different assoc/goal
    // state and bounce between the terminal blank line and the last content line.
    return true;
  }

  if (activeStructure) {
    const nextTargetLine = view.state.doc.lineAt(nextRange.head).number;
    const nextInsideActiveStructure = structureEditTargetContainsPos(
      activeStructure,
      nextRange.head,
    );
    const suspiciousStructureExit = !nextInsideActiveStructure
      && Math.abs(nextTargetLine - before.line) > SUSPICIOUS_STRUCTURE_EXIT_LINE_DELTA;
    const reversedStructureExit = !nextInsideActiveStructure
      && hasReversedVerticalDirection(before.line, nextTargetLine, forward);

    if (!nextInsideActiveStructure) {
      clearStructureEditTarget(view);
      const exitRange = activeStructure.kind === "display-math"
        ? suspiciousStructureExit || reversedStructureExit
          ? displayMathExitRange(activeStructure, forward)
          : EditorSelection.cursor(nextRange.head, forward ? 1 : -1)
        : suspiciousStructureExit || reversedStructureExit
          ? fallbackVerticalCursor(view, before.line, forward)
          : EditorSelection.cursor(nextRange.head, forward ? 1 : -1);
      const correctedTargetLine = view.state.doc.lineAt(exitRange.head).number;
      if (correctedTargetLine !== nextTargetLine) {
        recordVerticalMotionGuardEvent(view, {
          kind: "visible-line-jump",
          direction: forward ? "down" : "up",
          beforeLine: before.line,
          rawTargetLine: nextTargetLine,
          correctedTargetLine,
          timestamp: Date.now(),
        });
      }
      view.dispatch({
        selection: exitRange,
        scrollIntoView: false,
        userEvent: "select",
      });
    } else {
      view.dispatch({
        selection: view.state.selection.replaceRange(nextRange),
        scrollIntoView: false,
        userEvent: "select",
      });
    }
    preserveDirectionalScrollTop(view, before.scrollTop, forward);
    requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
    scheduleReverseScrollGuard(view, before, forward);
    return true;
  }

  const initialTargetLine = view.state.doc.lineAt(nextRange.head).number;
  const fallbackRange = hasReversedVerticalDirection(before.line, initialTargetLine, forward)
    ? fallbackVerticalCursor(view, before.line, forward)
    : null;
  if (fallbackRange) {
    const correctedTargetLine = view.state.doc.lineAt(fallbackRange.head).number;
    recordVerticalMotionGuardEvent(view, {
      kind: "visible-line-jump",
      direction: forward ? "down" : "up",
      beforeLine: before.line,
      rawTargetLine: initialTargetLine,
      correctedTargetLine,
      timestamp: Date.now(),
    });
  }
  const normalizedNextRange = fallbackRange ?? nextRange;
  const rawTargetLine = view.state.doc.lineAt(normalizedNextRange.head).number;
  const motionStartLine = view.state.doc.line(Math.min(before.line, rawTargetLine));
  const motionEndLine = view.state.doc.line(Math.max(before.line, rawTargetLine));
  const widgetStops = getWidgetStopIndex(view, [{
    from: motionStartLine.from,
    to: motionEndLine.to,
  }]);
  const hiddenWidgetStop = firstHiddenWidgetStopBetweenLines(
    widgetStops,
    before.line,
    rawTargetLine,
    forward,
  );
  if (hiddenWidgetStop) {
    const correctedTargetLine = hiddenWidgetStop.element.classList.contains(CSS.mathDisplay)
      ? activateDisplayMathStopBetweenLines(view, before.line, rawTargetLine, forward)
      : activateHiddenWidgetStop(view, hiddenWidgetStop, forward);
    if (correctedTargetLine !== null) {
      recordVerticalMotionGuardEvent(view, {
        kind: "visible-line-jump",
        direction: forward ? "down" : "up",
        beforeLine: before.line,
        rawTargetLine,
        correctedTargetLine,
        timestamp: Date.now(),
      });
      preserveDirectionalScrollTop(view, before.scrollTop, forward);
      requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
      scheduleReverseScrollGuard(view, before, forward);
      return true;
    }
  }

  const crossedTableStop = firstTableStopBetweenLines(
    widgetStops,
    before.line,
    rawTargetLine,
    forward,
  );
  if (crossedTableStop) {
    const correctedTargetLine = activateTableStop(view, crossedTableStop, forward);
    recordVerticalMotionGuardEvent(view, {
      kind: "visible-line-jump",
      direction: forward ? "down" : "up",
      beforeLine: before.line,
      rawTargetLine,
      correctedTargetLine,
      timestamp: Date.now(),
    });
    preserveDirectionalScrollTop(view, before.scrollTop, forward);
    requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
    scheduleReverseScrollGuard(view, before, forward);
    return true;
  }

  const landedWidgetStop = hiddenWidgetStopAtPos(widgetStops, normalizedNextRange.head);
  if (landedWidgetStop) {
    const correctedTargetLine = landedWidgetStop.element.classList.contains(CSS.mathDisplay)
      ? activateDisplayMathStopBetweenLines(view, before.line, rawTargetLine, forward)
      : activateHiddenWidgetStop(view, landedWidgetStop, forward);
    if (correctedTargetLine !== null) {
      recordVerticalMotionGuardEvent(view, {
        kind: "visible-line-jump",
        direction: forward ? "down" : "up",
        beforeLine: before.line,
        rawTargetLine,
        correctedTargetLine,
        timestamp: Date.now(),
      });
      preserveDirectionalScrollTop(view, before.scrollTop, forward);
      requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
      scheduleReverseScrollGuard(view, before, forward);
      return true;
    }
  }

  const landedTableStop = tableStopAtPos(widgetStops, normalizedNextRange.head);
  if (landedTableStop) {
    const correctedTargetLine = activateTableStop(view, landedTableStop, forward);
    recordVerticalMotionGuardEvent(view, {
      kind: "visible-line-jump",
      direction: forward ? "down" : "up",
      beforeLine: before.line,
      rawTargetLine,
      correctedTargetLine,
      timestamp: Date.now(),
    });
    preserveDirectionalScrollTop(view, before.scrollTop, forward);
    requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
    scheduleReverseScrollGuard(view, before, forward);
    return true;
  }

  const landedStructureTarget = createStructureEditTargetAt(view.state, normalizedNextRange.head);
  if (
    landedStructureTarget &&
    structureEditTargetContainsPos(landedStructureTarget, normalizedNextRange.head) &&
    activateStructureEditAt(view, normalizedNextRange.head)
  ) {
    preserveDirectionalScrollTop(view, before.scrollTop, forward);
    requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
    scheduleReverseScrollGuard(view, before, forward);
    return true;
  }

  view.dispatch({
    selection: view.state.selection.replaceRange(normalizedNextRange),
    scrollIntoView: false,
    userEvent: "select",
  });
  preserveDirectionalScrollTop(view, before.scrollTop, forward);
  requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
  scheduleReverseScrollGuard(view, before, forward);

  return true;
}
