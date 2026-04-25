import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { clearDocumentAnalysisCache } from "./semantics/incremental/cached-document-analysis";
import { installLocalStorageMock } from "./test-utils";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
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
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

const localStorageMock = installLocalStorageMock();

const rangePrototype = globalThis.Range?.prototype;
if (
  rangePrototype
  && typeof rangePrototype.getClientRects !== "function"
) {
  Object.defineProperty(rangePrototype, "getClientRects", {
    configurable: true,
    value() {
      return [] as DOMRect[];
    },
  });
}

beforeEach(() => {
  localStorageMock.clear();
});

afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
  }
  clearDocumentAnalysisCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
