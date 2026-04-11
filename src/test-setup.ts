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

const localStorageMock = installLocalStorageMock();

beforeEach(() => {
  localStorageMock.clear();
});
