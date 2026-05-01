import { describe, expect, it } from "vitest";
import {
  PERF_GATE_DEFAULTS,
  comparePerfDashboard,
  formatGateReport,
} from "./perf-gate-lib.mjs";

const baseSnapshot = {
  scenario: "typing-rich-burst",
  fixture: "fixtures/cogirth/main2.md",
  metrics: {
    "typing.dispatch_p95_ms": 10,
    "typing.dispatch_max_ms": 20,
    "typing.input_to_idle_ms": 200,
    "typing.longtask_count": 2,
    "typing.post_idle_lag_p95_ms": 4,
  },
};

describe("comparePerfDashboard", () => {
  it("reports ok when current matches baseline", () => {
    const result = comparePerfDashboard(baseSnapshot, baseSnapshot);
    expect(result.ok).toBe(true);
    expect(result.regressions).toEqual([]);
    expect(result.thresholdMultiplier).toBe(PERF_GATE_DEFAULTS.thresholdMultiplier);
  });

  it("flags a metric that exceeds the 1.5x multiplier", () => {
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.dispatch_p95_ms": 16 },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    expect(result.ok).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]).toMatchObject({
      metric: "typing.dispatch_p95_ms",
      baseline: 10,
      current: 16,
      threshold: 15,
      status: "regressed",
    });
  });

  it("does not flag values within threshold", () => {
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.dispatch_p95_ms": 14 },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    expect(result.ok).toBe(true);
  });

  it("respects min-delta-ms floor for small absolute changes", () => {
    // baseline 4 ms, threshold 6 ms; current 7 ms exceeds threshold but
    // delta=3 ms < default 5 ms floor -> still ok.
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.post_idle_lag_p95_ms": 7 },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    expect(result.ok).toBe(true);
  });

  it("uses min-delta-count for count metrics", () => {
    // baseline 2, threshold 3; current 4 -> delta 2 (>=1 floor) and ratio 2x -> regress.
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.longtask_count": 4 },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    expect(result.ok).toBe(false);
    expect(result.regressions[0].metric).toBe("typing.longtask_count");
  });

  it("treats missing metrics on either side as missing, not regressed", () => {
    const current = {
      ...baseSnapshot,
      metrics: {
        "typing.dispatch_p95_ms": 11,
        // dropped the others
      },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    expect(result.ok).toBe(true);
    const missing = result.comparisons.filter((c) => c.status === "missing");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("handles a baseline of 0 by using the absolute floor", () => {
    const baseline = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.longtask_count": 0 },
    };
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.longtask_count": 2 },
    };
    const result = comparePerfDashboard(baseline, current);
    const cmp = result.comparisons.find((c) => c.metric === "typing.longtask_count");
    expect(cmp.status).toBe("regressed");
  });

  it("formatGateReport includes scenario, fixture, and failing metric names", () => {
    const current = {
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, "typing.dispatch_p95_ms": 100 },
    };
    const result = comparePerfDashboard(baseSnapshot, current);
    const text = formatGateReport(result);
    expect(text).toContain("typing-rich-burst");
    expect(text).toContain("fixtures/cogirth/main2.md");
    expect(text).toContain("typing.dispatch_p95_ms");
    expect(text).toContain("REGRESSED");
  });
});
