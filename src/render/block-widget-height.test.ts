import { describe, expect, it } from "vitest";
import {
  cacheBlockWidgetHeight,
  estimatedBlockWidgetHeight,
} from "./block-widget-height";

describe("block-widget-height", () => {
  it("returns -1 when no measured height is cached", () => {
    expect(estimatedBlockWidgetHeight(new Map(), "math")).toBe(-1);
  });

  it("stores rounded heights and reports them as estimates", () => {
    const cache = new Map<string, number>();
    expect(cacheBlockWidgetHeight(cache, "math", 57.6)).toBe(true);
    expect(estimatedBlockWidgetHeight(cache, "math")).toBe(58);
  });

  it("ignores invalid measurements", () => {
    const cache = new Map<string, number>();
    expect(cacheBlockWidgetHeight(cache, "math", 0)).toBe(false);
    expect(cacheBlockWidgetHeight(cache, "math", Number.NaN)).toBe(false);
    expect(estimatedBlockWidgetHeight(cache, "math")).toBe(-1);
  });

  it("does not churn for effectively unchanged heights", () => {
    const cache = new Map<string, number>();
    expect(cacheBlockWidgetHeight(cache, "math", 58.2)).toBe(true);
    expect(cacheBlockWidgetHeight(cache, "math", 58.4)).toBe(false);
    expect(estimatedBlockWidgetHeight(cache, "math")).toBe(58);
  });
});
