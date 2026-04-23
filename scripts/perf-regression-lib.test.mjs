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

  it("treats missing baseline spans and metrics as compare failures", () => {
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
          name: "typing.wall_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 20,
          maxValue: 30,
        },
      ],
    };
    const current = {
      frontend: [],
      backend: [],
      metrics: [],
    };

    const result = comparePerfRegressionReports(baseline, current);

    expect(result.frontend[0]).toMatchObject({
      name: "open_file.read",
      status: "missing",
    });
    expect(result.metrics[0]).toMatchObject({
      name: "typing.wall_ms.cogirth_main2.inline_math",
      status: "missing",
    });
    expect(result.regressions).toHaveLength(2);
    expect(result.regressions.map((entry) => entry.status)).toEqual(["missing", "missing"]);
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

  it("does not fail a leaf frontend span when its category total stays within budget", () => {
    const baseline = {
      frontend: [
        {
          source: "frontend",
          category: "citations",
          name: "citations.parse_bib",
          meanAvgMs: 25,
          worstMaxMs: 40,
        },
        {
          source: "frontend",
          category: "citations",
          name: "citations.create_processor",
          meanAvgMs: 8,
          worstMaxMs: 15,
        },
      ],
      backend: [],
    };
    const current = {
      frontend: [
        {
          source: "frontend",
          category: "citations",
          name: "citations.parse_bib",
          meanAvgMs: 16,
          worstMaxMs: 28,
        },
        {
          source: "frontend",
          category: "citations",
          name: "citations.create_processor",
          meanAvgMs: 14,
          worstMaxMs: 25,
        },
      ],
      backend: [],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.25,
      minDeltaMs: 5,
    });

    expect(result.regressions).toHaveLength(0);
    expect(result.frontend.find((entry) => entry.name === "citations.create_processor")).toMatchObject({
      status: "ok",
      avgDeltaMs: 6,
    });
  });

  it("keeps max-only timing outliers from failing short local runs", () => {
    const baseline = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.settle_ms.index.after_frontmatter",
          unit: "ms",
          meanValue: 15,
          maxValue: 25,
        },
      ],
    };
    const current = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.settle_ms.index.after_frontmatter",
          unit: "ms",
          meanValue: 15.1,
          maxValue: 32,
        },
      ],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.25,
      minDeltaMs: 5,
    });

    expect(result.regressions).toHaveLength(0);
    expect(result.metrics[0]).toMatchObject({
      status: "ok",
      maxDelta: 7,
    });
  });

  it("keeps metric max-only outliers from failing without supporting mean movement", () => {
    const baseline = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.wall_ms.rankdecrease.near_end",
          unit: "ms",
          meanValue: 111.26,
          maxValue: 112.1,
        },
      ],
    };
    const current = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.wall_ms.rankdecrease.near_end",
          unit: "ms",
          meanValue: 114.14,
          maxValue: 129.8,
        },
      ],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.1,
      minDeltaMs: 2,
    });

    expect(result.regressions).toHaveLength(0);
    expect(result.metrics[0]).toMatchObject({
      status: "ok",
      meanDelta: 2.88,
      maxDelta: 17.7,
    });
  });

  it("keeps standalone scheduler metrics diagnostic while input-to-idle remains gated", () => {
    const baseline = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.idle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 2,
          maxValue: 4,
        },
        {
          name: "typing.settle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 12,
          maxValue: 15,
        },
        {
          name: "typing.input_to_idle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 100,
          maxValue: 110,
        },
      ],
    };
    const current = {
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.idle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 8,
          maxValue: 10,
        },
        {
          name: "typing.settle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 18,
          maxValue: 25,
        },
        {
          name: "typing.input_to_idle_ms.cogirth_main2.inline_math",
          unit: "ms",
          meanValue: 120,
          maxValue: 132,
        },
      ],
    };

    const result = comparePerfRegressionReports(baseline, current, {
      thresholdPct: 0.1,
      minDeltaMs: 2,
    });

    expect(result.metrics.find((entry) => entry.name.startsWith("typing.idle_ms."))).toMatchObject({
      status: "ok",
      meanDelta: 6,
    });
    expect(result.metrics.find((entry) => entry.name.startsWith("typing.settle_ms."))).toMatchObject({
      status: "ok",
      meanDelta: 6,
    });
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]).toMatchObject({
      name: "typing.input_to_idle_ms.cogirth_main2.inline_math",
      status: "regressed",
    });
  });
});
