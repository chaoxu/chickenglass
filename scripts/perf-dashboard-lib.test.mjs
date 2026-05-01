import { describe, expect, it } from "vitest";
import {
  DASHBOARD_METRIC_KEYS,
  buildDashboardMetrics,
  buildDashboardSnapshot,
  stableStringify,
} from "./perf-dashboard-lib.mjs";

const fakeReport = {
  scenario: "typing-rich-burst",
  iterations: 3,
  warmup: 1,
  capturedAt: "2026-04-30T00:00:00.000Z",
  metrics: [
    // "max-of-mean" base -> 12 wins.
    { name: "typing.dispatch_p95_ms.demo.prose_top", unit: "ms", meanValue: 8, maxValue: 11, samples: 3 },
    { name: "typing.dispatch_p95_ms.cogirth.inline_math", unit: "ms", meanValue: 12, maxValue: 18, samples: 3 },
    // "max-of-max" base -> 22 wins.
    { name: "typing.dispatch_max_ms.demo.prose_top", unit: "ms", meanValue: 15, maxValue: 20, samples: 3 },
    { name: "typing.dispatch_max_ms.cogirth.inline_math", unit: "ms", meanValue: 16, maxValue: 22, samples: 3 },
    // sum-of-mean -> 5
    { name: "typing.longtask_count.demo.prose_top", unit: "count", meanValue: 2, maxValue: 3, samples: 3 },
    { name: "typing.longtask_count.cogirth.inline_math", unit: "count", meanValue: 3, maxValue: 4, samples: 3 },
    // unrelated metric should be ignored
    { name: "scroll.cold_jump_ms", unit: "ms", meanValue: 100, maxValue: 120, samples: 3 },
  ],
};

describe("buildDashboardMetrics", () => {
  it("aggregates per-case metrics into a flat object", () => {
    const result = buildDashboardMetrics(fakeReport);
    expect(result["typing.dispatch_p95_ms"]).toBe(12);
    expect(result["typing.dispatch_max_ms"]).toBe(22);
    expect(result["typing.longtask_count"]).toBe(5);
  });

  it("emits 0 for metrics not present in the report", () => {
    const result = buildDashboardMetrics({ metrics: [] });
    expect(result["typing.dispatch_p95_ms"]).toBe(0);
  });

  it("includes every documented metric key in stable order", () => {
    const result = buildDashboardMetrics(fakeReport);
    const keys = Object.keys(result);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    for (const key of DASHBOARD_METRIC_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });
});

describe("buildDashboardSnapshot", () => {
  it("produces a stable, sorted object suitable for JSON paste", () => {
    const snapshot = buildDashboardSnapshot({
      report: fakeReport,
      commit: "deadbeef",
      fixture: "fixtures/cogirth/main2.md",
    });
    expect(Object.keys(snapshot)).toEqual([
      "capturedAt",
      "commit",
      "fixture",
      "iterations",
      "metrics",
      "scenario",
      "warmup",
    ]);
    expect(snapshot.commit).toBe("deadbeef");
    expect(snapshot.fixture).toBe("fixtures/cogirth/main2.md");
    expect(snapshot.scenario).toBe("typing-rich-burst");
  });

  it("emits valid JSON via stableStringify", () => {
    const snapshot = buildDashboardSnapshot({
      report: fakeReport,
      commit: "deadbeef",
      fixture: "fixtures/cogirth/main2.md",
    });
    const json = stableStringify(snapshot);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json.endsWith("\n")).toBe(true);
  });
});
