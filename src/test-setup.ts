import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { installLocalStorageMock } from "./test-utils";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  // Tests expect lazy-rendered content (e.g. KaTeX) to appear synchronously,
  // so the polyfill fires "intersecting" immediately on observe().
  globalThis.IntersectionObserver = class IntersectionObserver {
    private readonly callback: (entries: IntersectionObserverEntry[]) => void;
    constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as unknown as typeof IntersectionObserver;
}

const localStorageMock = installLocalStorageMock();

beforeEach(() => {
  localStorageMock.clear();
});
