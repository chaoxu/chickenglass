import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { ScrollGuardEvent } from "../lib/debug-types";

const LARGE_HEIGHT_CORRECTION_THRESHOLD = 256;
const MAX_SCROLL_GUARD_EVENTS = 100;
const REVERSE_SCROLL_DRIFT_THRESHOLD = 48;
const SCROLL_GUARD_RELEASE_THRESHOLD = 64;
const WHEEL_INTENT_WINDOW_MS = 250;

interface WheelIntent {
  readonly deltaY: number;
  readonly at: number;
  readonly targetTop: number | null;
}

interface DownwardHeightCollapseGuardArgs {
  readonly previousTop: number;
  readonly previousHeight: number;
  readonly currentTop: number;
  readonly currentHeight: number;
  readonly clientHeight: number;
  readonly wheelDeltaY: number;
  readonly wheelAgeMs: number;
  readonly preservedMaxScrollTop: number | null;
  readonly preservedTargetTop: number | null;
}

export interface DownwardHeightCollapseGuardResult {
  readonly correctedTop: number;
  readonly paddingBottom: number;
  readonly preservedMaxScrollTop: number;
  readonly observedMaxScrollTop: number;
}

const scrollGuardEvents: ScrollGuardEvent[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function pushScrollGuardEvent(event: ScrollGuardEvent): void {
  scrollGuardEvents.push(event);
  if (scrollGuardEvents.length > MAX_SCROLL_GUARD_EVENTS) {
    scrollGuardEvents.splice(0, scrollGuardEvents.length - MAX_SCROLL_GUARD_EVENTS);
  }
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

export function getScrollGuardEvents(): readonly ScrollGuardEvent[] {
  return scrollGuardEvents;
}

export function clearScrollGuardEvents(): void {
  scrollGuardEvents.length = 0;
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

export function guardDownwardHeightCollapse(
  args: DownwardHeightCollapseGuardArgs,
): DownwardHeightCollapseGuardResult | null {
  const {
    previousTop,
    previousHeight,
    currentTop,
    currentHeight,
    clientHeight,
    wheelDeltaY,
    wheelAgeMs,
    preservedMaxScrollTop,
    preservedTargetTop,
  } = args;
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY <= 0) return null;
  if (!Number.isFinite(wheelAgeMs) || wheelAgeMs > WHEEL_INTENT_WINDOW_MS) return null;
  if (Math.abs(currentHeight - previousHeight) < LARGE_HEIGHT_CORRECTION_THRESHOLD) {
    return null;
  }

  const actualDelta = currentTop - previousTop;
  const reversed = actualDelta < -REVERSE_SCROLL_DRIFT_THRESHOLD;
  const heightCollapsed = currentHeight < previousHeight - LARGE_HEIGHT_CORRECTION_THRESHOLD;
  const targetMagnitude = Math.max(wheelDeltaY, REVERSE_SCROLL_DRIFT_THRESHOLD);
  const underDeliveredDownwardScroll = heightCollapsed
    && actualDelta < targetMagnitude - REVERSE_SCROLL_DRIFT_THRESHOLD;
  if (!reversed && !underDeliveredDownwardScroll) return null;

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
  const rawTarget = Number.isFinite(preservedTargetTop ?? NaN)
    ? Math.round(preservedTargetTop ?? 0)
    : Math.round(previousTop + targetMagnitude);
  const correctedTop = clamp(rawTarget, 0, correctedMaxScrollTop);
  if (correctedTop <= currentTop) return null;
  return {
    correctedTop,
    paddingBottom,
    preservedMaxScrollTop: nextPreservedMaxScrollTop,
    observedMaxScrollTop: rawObservedMaxScrollTop,
  };
}

class ScrollStabilityPlugin {
  private raf = 0;
  private lastScrollTop = 0;
  private lastScrollHeight = 0;
  private lastWheelIntent: WheelIntent | null = null;
  private scrollGuardPadding = 0;
  private preservedMaxScrollTop: number | null = null;

  constructor(private readonly view: EditorView) {
    const scroller = view.scrollDOM;
    this.lastScrollTop = scroller.scrollTop;
    this.lastScrollHeight = scroller.scrollHeight;
    scroller.addEventListener("wheel", this.onWheel, { passive: true });
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.lastWheelIntent = null;
      this.releaseRunway();
    }
  }

  destroy(): void {
    const scroller = this.view.scrollDOM;
    scroller.removeEventListener("wheel", this.onWheel);
    scroller.removeEventListener("scroll", this.onScroll);
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.releaseRunway();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0) return;
    const scroller = this.view.scrollDOM;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    this.lastWheelIntent = {
      deltaY: event.deltaY,
      at: nowMs(),
      targetTop: clamp(
        Math.round(scroller.scrollTop + event.deltaY),
        0,
        maxScrollTop,
      ),
    };
  };

  private readonly onScroll = (): void => {
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
    }

    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.view.dom.isConnected) return;
      this.stabilizeAfterScroll();
    });
  };

  private stabilizeAfterScroll(): void {
    const scroller = this.view.scrollDOM;
    let currentTop = scroller.scrollTop;
    const previousTop = this.lastScrollTop;
    const currentHeight = Math.max(0, scroller.scrollHeight - this.scrollGuardPadding);
    const previousHeight = this.lastScrollHeight;
    const wheelIntent = this.lastWheelIntent;

    const guardResult = wheelIntent
      ? guardDownwardHeightCollapse({
        previousTop,
        previousHeight,
        currentTop,
        currentHeight,
        clientHeight: scroller.clientHeight,
        wheelDeltaY: wheelIntent.deltaY,
        wheelAgeMs: nowMs() - wheelIntent.at,
        preservedMaxScrollTop: this.preservedMaxScrollTop,
        preservedTargetTop: wheelIntent.targetTop,
      })
      : null;

    if (guardResult && wheelIntent && guardResult.correctedTop !== currentTop) {
      this.scrollGuardPadding = guardResult.paddingBottom;
      this.preservedMaxScrollTop = guardResult.preservedMaxScrollTop;
      setScrollGuardPadding(this.view.contentDOM, guardResult.paddingBottom);
      this.recordGuardEvent(previousTop, currentTop, previousHeight, currentHeight, guardResult, wheelIntent);
      scroller.scrollTop = guardResult.correctedTop;
      currentTop = guardResult.correctedTop;
      this.lastWheelIntent = {
        ...wheelIntent,
        targetTop: guardResult.correctedTop,
      };
      this.view.requestMeasure();
    }

    this.updateRunway(currentTop, currentHeight);
    this.lastScrollTop = currentTop;
    this.lastScrollHeight = currentHeight;
  }

  private recordGuardEvent(
    previousTop: number,
    observedTop: number,
    previousHeight: number,
    currentHeight: number,
    guardResult: DownwardHeightCollapseGuardResult,
    wheelIntent: WheelIntent,
  ): void {
    const preservesWheelTarget = wheelIntent.deltaY > 0
      && wheelIntent.targetTop !== null
      && Math.abs(guardResult.correctedTop - wheelIntent.targetTop) <= 1;
    if (preservesWheelTarget) return;
    pushScrollGuardEvent({
      timestamp: Date.now(),
      wheelDeltaY: wheelIntent.deltaY,
      previousTop,
      correctedTop: guardResult.correctedTop,
      observedTop,
      previousHeight,
      currentHeight,
      paddingBottom: guardResult.paddingBottom,
      preservedMaxScrollTop: guardResult.preservedMaxScrollTop,
      observedMaxScrollTop: guardResult.observedMaxScrollTop,
    });
  }

  private updateRunway(currentTop: number, currentHeight: number): void {
    if (this.preservedMaxScrollTop === null) return;

    const observedMaxScrollTop = Math.max(0, currentHeight - this.view.scrollDOM.clientHeight);
    const needsPreservedRunway = currentTop >= observedMaxScrollTop - SCROLL_GUARD_RELEASE_THRESHOLD;
    const nextPadding = needsPreservedRunway
      ? computeScrollGuardPadding(
        currentHeight,
        this.view.scrollDOM.clientHeight,
        this.preservedMaxScrollTop,
      )
      : 0;
    if (nextPadding !== this.scrollGuardPadding) {
      this.scrollGuardPadding = nextPadding;
      setScrollGuardPadding(this.view.contentDOM, nextPadding);
    }
    if (nextPadding === 0) {
      this.preservedMaxScrollTop = null;
    }
  }

  private releaseRunway(): void {
    this.scrollGuardPadding = 0;
    this.preservedMaxScrollTop = null;
    setScrollGuardPadding(this.view.contentDOM, 0);
  }
}

export const scrollStabilityExtension = ViewPlugin.fromClass(ScrollStabilityPlugin);
