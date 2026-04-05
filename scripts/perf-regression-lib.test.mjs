import { describe, expect, it } from "vitest";
import {
  PERF_REPORT_VERSION,
  buildPerfRegressionReport,
  comparePerfRegressionReports,
} from "./perf-regression-lib.mjs";

describe("perf regression reports", () => {
  it("aggregates repeated summaries across iterations", () => {
    const report = buildPerfRegressionReport({
      scenario: "open-index",
      iterations: 2,
      warmup: 1,
      settleMs: 400,
      chromePort: 9322,
      appUrl: "http://127.0.0.1:5173",
      snapshots: [
        {
          frontend: {
            summaries: [
              {
                source: "frontend",
                category: "open_file",
                name: "open_file.read",
                count: 1,
                avgMs: 20,
                maxMs: 20,
                lastMs: 20,
              },
            ],
          },
          backend: {
            summaries: [
              {
                source: "backend",
                category: "tauri",
                name: "tauri.read_file",
                count: 1,
                avgMs: 10,
                maxMs: 10,
                lastMs: 10,
              },
            ],
          },
          metrics: [
            {
              name: "semantic.changed_slice_count",
              unit: "count",
              value: 1,
            },
          ],
        },
        {
          frontend: {
            summaries: [
              {
                source: "frontend",
                category: "open_file",
                name: "open_file.read",
                count: 1,
                avgMs: 40,
                maxMs: 45,
                lastMs: 45,
              },
            ],
          },
          backend: {
            summaries: [
              {
                source: "backend",
                category: "tauri",
                name: "tauri.read_file",
                count: 1,
                avgMs: 11,
                maxMs: 12,
                lastMs: 12,
              },
            ],
          },
          metrics: [
            {
              name: "semantic.changed_slice_count",
              unit: "count",
              value: 2,
            },
          ],
        },
      ],
    });

    expect(report.version).toBe(PERF_REPORT_VERSION);
    expect(report.frontend[0]).toMatchObject({
      name: "open_file.read",
      meanAvgMs: 30,
      worstMaxMs: 45,
      meanLastMs: 32.5,
      meanCount: 1,
      samples: 2,
    });
    expect(report.backend[0]).toMatchObject({
      name: "tauri.read_file",
      meanAvgMs: 10.5,
      worstMaxMs: 12,
      samples: 2,
    });
    expect(report.metrics[0]).toMatchObject({
      name: "semantic.changed_slice_count",
      unit: "count",
      meanValue: 1.5,
      maxValue: 2,
      samples: 2,
    });
    expect(report.requiredMetrics).toEqual([]);
  });

  it("fails fast when required metrics are missing or incomplete", () => {
    expect(() => buildPerfRegressionReport({
      scenario: "typing-rich-burst",
      iterations: 2,
      warmup: 0,
      settleMs: 200,
      chromePort: 9322,
      appUrl: "http://127.0.0.1:5173",
      requiredMetrics: [
        "typing.wall_ms.cogirth_main2.inline_math",
        "typing.dispatch_mean_ms.cogirth_main2.citation_ref",
      ],
      snapshots: [
        {
          frontend: { summaries: [] },
          backend: null,
          metrics: [
            {
              name: "typing.wall_ms.cogirth_main2.inline_math",
              unit: "ms",
              value: 10,
            },
          ],
        },
        {
          frontend: { summaries: [] },
          backend: null,
          metrics: [],
        },
      ],
    })).toThrow(
      "Missing required perf metrics: typing.dispatch_mean_ms.cogirth_main2.citation_ref (missing), typing.wall_ms.cogirth_main2.inline_math (samples 1/2)",
    );
  });

  it("flags regressions only when both percent and absolute deltas are exceeded", () => {
    const baseline = {
      frontend: [
        {
          source: "frontend",
          category: "open_file",
          name: "open_file.read",
          meanAvgMs: 20,
          worstMaxMs: 30,
        },
      ],
      backend: [],
      metrics: [
        {
          name: "semantic.changed_slice_count",
          unit: "count",
          meanValue: 1,
          maxValue: 1,
        },
      ],
    };
    const current = {
      frontend: [
        {
          source: "frontend",
          category: "open_file",
          name: "open_file.read",
          meanAvgMs: 30,
          worstMaxMs: 50,
        },
      ],
      backend: [],
      metrics: [
        {
          name: "semantic.changed_slice_count",
          unit: "count",
          meanValue: 2,
          maxValue: 3,
        },
      ],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.25,
      minDeltaMs: 5,
    });

    expect(result.regressions).toHaveLength(2);
    expect(result.regressions[0]).toMatchObject({
      name: "open_file.read",
      status: "regressed",
      avgDeltaMs: 10,
      maxDeltaMs: 20,
    });
    expect(result.regressions[1]).toMatchObject({
      name: "semantic.changed_slice_count",
      status: "regressed",
      meanDelta: 1,
      maxDelta: 2,
    });
  });

  it("does not flag tiny absolute deltas even when percentages look large", () => {
    const baseline = {
      frontend: [
        {
          source: "frontend",
          category: "open_file",
          name: "open_file.read",
          meanAvgMs: 2,
          worstMaxMs: 3,
        },
      ],
      backend: [],
    };
    const current = {
      frontend: [
        {
          source: "frontend",
          category: "open_file",
          name: "open_file.read",
          meanAvgMs: 3,
          worstMaxMs: 4,
        },
      ],
      backend: [],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.25,
      minDeltaMs: 5,
    });

    expect(result.regressions).toHaveLength(0);
    expect(result.frontend[0].status).toBe("ok");
  });
});
