import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { installLocalStorageMock } from "./test-utils";

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
