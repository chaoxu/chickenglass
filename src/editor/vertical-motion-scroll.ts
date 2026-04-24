import { type EditorView } from "@codemirror/view";
import { getLineElement } from "../render/render-core";
import { appendDebugTimelineEvent } from "./debug-timeline";
import {
  boundedDirectionalScrollTop,
  correctedReverseVerticalScrollTop,
  FALLBACK_LINE_HEIGHT_PX,
  maxDirectionalScrollStep,
  REVERSE_SCROLL_CORRECTION_ATTEMPTS,
  REVERSE_SCROLL_CORRECTION_DELAYS_MS,
  REVERSE_SCROLL_JITTER_PX,
  sumTraversedLineHeights,
  type VerticalMotionSnapshot,
} from "./vertical-motion-scroll-model";

const MAX_GUARD_EVENTS = 20;

const activeReverseScrollGuards = new WeakMap<EditorView, ReverseScrollGuard>();
const verticalMotionGuardEvents = new WeakMap<EditorView, VerticalMotionGuardEvent[]>();
let nextReverseScrollGuardId = 0;

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

export function snapshotVerticalMotion(view: EditorView): VerticalMotionSnapshot {
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

export function requestSelectionVisibility(
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

export function preserveDirectionalScrollTop(
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

export function scheduleReverseScrollGuard(
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
