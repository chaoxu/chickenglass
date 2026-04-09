/**
 * useEditorScroll — tracks scroll position and viewport offset of a CM6 editor.
 *
 * Extracted from useEditor so scroll-tracking concerns are isolated.
 * Attaches a passive scroll listener to the editor's scrollDOM and
 * writes scroll telemetry (scrollTop, viewportFrom) directly to the
 * Zustand editorTelemetryStore — no React useState, so scrolling does
 * NOT trigger React re-renders of EditorPane or its children (#465).
 *
 * Debounces writes via requestAnimationFrame. After large scroll jumps
 * (> 2000px), schedules a CM6 requestMeasure() to ensure the viewport
 * is recalculated correctly (#463).
 */

import { useEffect, useCallback, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";

/**
 * Minimum scroll delta (in pixels) that triggers a CM6 requestMeasure().
 * Large jumps can leave the viewport blank because CM6's lazy rendering
 * hasn't caught up; requestMeasure() forces a remeasure cycle.
 */
const LARGE_SCROLL_THRESHOLD = 2000;
const WHEEL_INTENT_WINDOW_MS = 250;
const REVERSE_SCROLL_DRIFT_THRESHOLD = 48;
const HEIGHT_CORRECTION_THRESHOLD = 256;
const MAX_SCROLL_GUARD_EVENTS = 100;
const SCROLL_GUARD_RELEASE_THRESHOLD = 64;

export interface ScrollGuardEvent {
  readonly timestamp: number;
  readonly wheelDeltaY: number;
  readonly previousTop: number;
  readonly correctedTop: number;
  readonly observedTop: number;
  readonly previousHeight: number;
  readonly currentHeight: number;
  readonly paddingBottom: number;
  readonly preservedMaxScrollTop: number;
  readonly observedMaxScrollTop: number;
}

const scrollGuardEvents: ScrollGuardEvent[] = [];

function pushScrollGuardEvent(event: ScrollGuardEvent): void {
  scrollGuardEvents.push(event);
  if (scrollGuardEvents.length > MAX_SCROLL_GUARD_EVENTS) {
    scrollGuardEvents.splice(0, scrollGuardEvents.length - MAX_SCROLL_GUARD_EVENTS);
  }
}

export function getScrollGuardEvents(): readonly ScrollGuardEvent[] {
  return scrollGuardEvents;
}

export function clearScrollGuardEvents(): void {
  scrollGuardEvents.length = 0;
}

interface ReverseScrollGuardArgs {
  readonly previousTop: number;
  readonly previousHeight: number;
  readonly currentTop: number;
  readonly currentHeight: number;
  readonly clientHeight: number;
  readonly wheelDeltaY: number;
  readonly wheelAgeMs: number;
  readonly preservedMaxScrollTop: number | null;
}

export interface ReverseScrollGuardResult {
  readonly correctedTop: number;
  readonly paddingBottom: number;
  readonly preservedMaxScrollTop: number;
  readonly observedMaxScrollTop: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function setScrollGuardPadding(
  host: HTMLElement,
  paddingBottom: number,
): void {
  if (paddingBottom > 0) {
    host.style.paddingBottom = `${paddingBottom}px`;
  } else {
    host.style.removeProperty("padding-bottom");
  }
}

export function computeScrollGuardPadding(
  currentHeight: number,
  clientHeight: number,
  preservedMaxScrollTop: number | null,
): number {
  if (preservedMaxScrollTop === null) return 0;
  const observedMaxScrollTop = Math.max(0, currentHeight - clientHeight);
  return Math.max(0, Math.round(preservedMaxScrollTop - observedMaxScrollTop));
}

export function guardReverseScrollRemap(
  args: ReverseScrollGuardArgs,
): ReverseScrollGuardResult | null {
  const {
    previousTop,
    previousHeight,
    currentTop,
    currentHeight,
    clientHeight,
    wheelDeltaY,
    wheelAgeMs,
    preservedMaxScrollTop,
  } = args;
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return null;
  if (!Number.isFinite(wheelAgeMs) || wheelAgeMs > WHEEL_INTENT_WINDOW_MS) return null;
  if (Math.abs(currentHeight - previousHeight) < HEIGHT_CORRECTION_THRESHOLD) return null;

  const direction = Math.sign(wheelDeltaY);
  const actualDelta = currentTop - previousTop;
  const reversed = direction > 0
    ? actualDelta < -REVERSE_SCROLL_DRIFT_THRESHOLD
    : actualDelta > REVERSE_SCROLL_DRIFT_THRESHOLD;
  if (!reversed || direction < 0) return null;

  const targetMagnitude = Math.max(Math.abs(wheelDeltaY), REVERSE_SCROLL_DRIFT_THRESHOLD);
  const rawObservedMaxScrollTop = Math.max(0, currentHeight - clientHeight);
  const rawPreviousMaxScrollTop = Math.max(0, previousHeight - clientHeight);
  const nextPreservedMaxScrollTop = Math.max(
    preservedMaxScrollTop ?? 0,
    rawPreviousMaxScrollTop,
  );
  const paddingBottom = Math.max(
    0,
    Math.round(nextPreservedMaxScrollTop - rawObservedMaxScrollTop),
  );
  const correctedMaxScrollTop = rawObservedMaxScrollTop + paddingBottom;
  const rawTarget = Math.round(previousTop + direction * targetMagnitude);
  const correctedTop = clamp(rawTarget, 0, correctedMaxScrollTop);
  if (correctedTop <= currentTop) return null;
  return {
    correctedTop,
    paddingBottom,
    preservedMaxScrollTop: nextPreservedMaxScrollTop,
    observedMaxScrollTop: rawObservedMaxScrollTop,
  };
}

export interface UseEditorScrollReturn {
  /** Reset scroll state (call when editor is recreated). */
  resetScroll: () => void;
}

export function useEditorScroll(view: EditorView | null): UseEditorScrollReturn {
  const rafRef = useRef<number>(0);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const lastWheelIntentRef = useRef<{ deltaY: number; at: number } | null>(null);
  const scrollGuardPaddingRef = useRef(0);
  const preservedMaxScrollTopRef = useRef<number | null>(null);

  const resetScroll = useCallback(() => {
    useEditorTelemetryStore.getState().setScroll(0, 0);
    lastScrollTopRef.current = 0;
    lastScrollHeightRef.current = 0;
    lastWheelIntentRef.current = null;
    scrollGuardPaddingRef.current = 0;
    preservedMaxScrollTopRef.current = null;
  }, []);

  useEffect(() => {
    if (!view) return;

    const scroller = view.scrollDOM;
    const paddingHost = view.contentDOM;
    lastScrollTopRef.current = scroller.scrollTop;
    lastScrollHeightRef.current = scroller.scrollHeight;

    let cancelled = false;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      lastWheelIntentRef.current = { deltaY: event.deltaY, at: now };
    };

    const onScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (cancelled) return;
        let currentTop = scroller.scrollTop;
        const previousTop = lastScrollTopRef.current;
        const currentHeight = Math.max(0, scroller.scrollHeight - scrollGuardPaddingRef.current);
        const previousHeight = lastScrollHeightRef.current;
        const wheelIntent = lastWheelIntentRef.current;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const guardResult = wheelIntent
          ? guardReverseScrollRemap({
              previousTop,
              previousHeight,
              currentTop,
              currentHeight,
              clientHeight: scroller.clientHeight,
              wheelDeltaY: wheelIntent.deltaY,
              wheelAgeMs: now - wheelIntent.at,
              preservedMaxScrollTop: preservedMaxScrollTopRef.current,
            })
          : null;
        if (guardResult && guardResult.correctedTop !== currentTop) {
          scrollGuardPaddingRef.current = guardResult.paddingBottom;
          preservedMaxScrollTopRef.current = guardResult.preservedMaxScrollTop;
          setScrollGuardPadding(paddingHost, guardResult.paddingBottom);
          pushScrollGuardEvent({
            timestamp: Date.now(),
            wheelDeltaY: wheelIntent?.deltaY ?? 0,
            previousTop,
            correctedTop: guardResult.correctedTop,
            observedTop: currentTop,
            previousHeight,
            currentHeight,
            paddingBottom: guardResult.paddingBottom,
            preservedMaxScrollTop: guardResult.preservedMaxScrollTop,
            observedMaxScrollTop: guardResult.observedMaxScrollTop,
          });
          scroller.scrollTop = guardResult.correctedTop;
          currentTop = guardResult.correctedTop;
          view.requestMeasure();
        }
        if (preservedMaxScrollTopRef.current !== null) {
          const observedMaxScrollTop = Math.max(0, currentHeight - scroller.clientHeight);
          const needsPreservedRunway = currentTop >= observedMaxScrollTop - SCROLL_GUARD_RELEASE_THRESHOLD;
          const nextPadding = needsPreservedRunway
            ? computeScrollGuardPadding(
                currentHeight,
                scroller.clientHeight,
                preservedMaxScrollTopRef.current,
              )
            : 0;
          if (nextPadding !== scrollGuardPaddingRef.current) {
            scrollGuardPaddingRef.current = nextPadding;
            setScrollGuardPadding(paddingHost, nextPadding);
          }
          if (nextPadding === 0) {
            preservedMaxScrollTopRef.current = null;
          }
        }
        const delta = Math.abs(currentTop - previousTop);
        lastScrollTopRef.current = currentTop;
        lastScrollHeightRef.current = currentHeight;

        // Use lineBlockAtHeight for accurate position
        const topPos = view.lineBlockAtHeight(currentTop).from;

        // Write to Zustand store — no React setState, so no re-renders (#465).
        useEditorTelemetryStore.getState().setScroll(currentTop, topPos);

        // After a large scroll jump, CM6's lazy viewport rendering may
        // leave the visible area blank. Force a remeasure so CM6
        // recalculates which lines need to be drawn (#463).
        if (delta >= LARGE_SCROLL_THRESHOLD) {
          view.requestMeasure();
        }
      });
    };

    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelled = true;
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("scroll", onScroll);
      setScrollGuardPadding(paddingHost, 0);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [view]);

  return { resetScroll };
}
