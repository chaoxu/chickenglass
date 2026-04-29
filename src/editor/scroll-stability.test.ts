import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestView,
  destroyAllTestViews,
} from "../test-utils";
import {
  computeScrollGuardPadding,
  guardDownwardHeightCollapse,
  scrollStabilityExtension,
} from "./scroll-stability";

function setScrollerGeometry(
  scroller: HTMLElement,
  geometry: {
    readonly scrollHeight: number;
    readonly clientHeight: number;
  },
): void {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: geometry.scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: geometry.clientHeight,
  });
}

function flushAnimationFrame(): void {
  vi.advanceTimersByTime(16);
}

afterEach(() => {
  destroyAllTestViews();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guardDownwardHeightCollapse", () => {
  it("returns a corrected forward target plus preserved runway for reversed downward drift", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1000,
      currentHeight: 2400,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
      preservedTargetTop: null,
    })).toEqual({
      correctedTop: 1490,
      paddingBottom: 600,
      preservedMaxScrollTop: 2400,
      observedMaxScrollTop: 1800,
    });
  });

  it("preserves runway when a downward wheel is under-delivered by height collapse", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 25_983,
      previousHeight: 33_530,
      currentTop: 26_001,
      currentHeight: 27_191,
      clientHeight: 876,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
      preservedTargetTop: 26_073,
    })).toEqual({
      correctedTop: 26_073,
      paddingBottom: 6_339,
      preservedMaxScrollTop: 32_654,
      observedMaxScrollTop: 26_315,
    });
  });

  it("returns null for ordinary forward scroll", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1490,
      currentHeight: 3000,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
      preservedTargetTop: null,
    })).toBeNull();
  });

  it("returns null for upward wheels because this guard only preserves downward runway", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1600,
      currentHeight: 2400,
      clientHeight: 600,
      wheelDeltaY: -90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
      preservedTargetTop: null,
    })).toBeNull();
  });

  it("returns null without a large height correction", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1000,
      currentHeight: 2850,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
      preservedTargetTop: null,
    })).toBeNull();
  });

  it("reuses the preserved wheel target instead of adding another wheel step", () => {
    expect(guardDownwardHeightCollapse({
      previousTop: 1490,
      previousHeight: 2400,
      currentTop: 1200,
      currentHeight: 1800,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: 2400,
      preservedTargetTop: 1490,
    })).toEqual({
      correctedTop: 1490,
      paddingBottom: 1200,
      preservedMaxScrollTop: 2400,
      observedMaxScrollTop: 1200,
    });
  });
});

describe("computeScrollGuardPadding", () => {
  it("preserves prior runway until raw height catches up", () => {
    expect(computeScrollGuardPadding(2400, 600, 2400)).toBe(600);
    expect(computeScrollGuardPadding(3000, 600, 2400)).toBe(0);
  });
});

describe("scrollStabilityExtension", () => {
  it("corrects wheel-driven downward remaps after a large height collapse", () => {
    vi.useFakeTimers();
    const view = createTestView("one\ntwo\nthree\n", {
      extensions: [scrollStabilityExtension],
    });
    const requestMeasure = vi.spyOn(view, "requestMeasure").mockImplementation(() => undefined);
    setScrollerGeometry(view.scrollDOM, {
      scrollHeight: 33_530,
      clientHeight: 876,
    });

    view.scrollDOM.scrollTop = 26_500;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    flushAnimationFrame();
    requestMeasure.mockClear();

    view.scrollDOM.dispatchEvent(new WheelEvent("wheel", { deltaY: 90 }));
    setScrollerGeometry(view.scrollDOM, {
      scrollHeight: 27_191,
      clientHeight: 876,
    });
    view.scrollDOM.scrollTop = 26_000;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    flushAnimationFrame();

    expect(view.scrollDOM.scrollTop).toBe(26_590);
    expect(view.contentDOM.style.paddingBottom).toBe("6339px");
    expect(requestMeasure).toHaveBeenCalled();
  });
});
