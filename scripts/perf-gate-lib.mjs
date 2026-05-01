// Threshold-comparison logic for the perf gate. Pure: takes two dashboard
// snapshots and returns a structured regression report.

const DEFAULT_THRESHOLD_MULTIPLIER = 1.5;
const DEFAULT_MIN_DELTA_MS = 5;

// Metrics that are counts, not durations. The min-delta-ms floor does not
// apply; we use a min-delta-count instead.
const COUNT_METRICS = new Set([
  "typing.longtask_count",
  "typing.post_idle_longtask_count",
]);

const DEFAULT_MIN_DELTA_COUNT = 1;

function roundTo(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function comparePerfDashboard(baseline, current, options = {}) {
  const multiplier = options.thresholdMultiplier ?? DEFAULT_THRESHOLD_MULTIPLIER;
  const minDeltaMs = options.minDeltaMs ?? DEFAULT_MIN_DELTA_MS;
  const minDeltaCount = options.minDeltaCount ?? DEFAULT_MIN_DELTA_COUNT;

  const baselineMetrics = baseline?.metrics ?? {};
  const currentMetrics = current?.metrics ?? {};
  const keys = new Set([
    ...Object.keys(baselineMetrics),
    ...Object.keys(currentMetrics),
  ]);

  const comparisons = [];
  for (const key of [...keys].sort()) {
    const baselineValue = baselineMetrics[key];
    const currentValue = currentMetrics[key];
    if (typeof baselineValue !== "number" || typeof currentValue !== "number") {
      comparisons.push({
        metric: key,
        baseline: baselineValue ?? null,
        current: currentValue ?? null,
        threshold: null,
        delta: null,
        ratio: null,
        status: "missing",
      });
      continue;
    }

    const isCount = COUNT_METRICS.has(key);
    const minDelta = isCount ? minDeltaCount : minDeltaMs;
    const threshold = roundTo(baselineValue * multiplier);
    const delta = roundTo(currentValue - baselineValue);
    // Special case: a baseline of 0 with a non-trivial current value should
    // regress. Ratio is undefined; report it as null but mark regressed when
    // current exceeds the absolute floor.
    let ratio = null;
    let regressed = false;
    if (baselineValue > 0) {
      ratio = roundTo(currentValue / baselineValue);
      regressed = currentValue > threshold && delta >= minDelta;
    } else {
      regressed = currentValue >= minDelta;
    }

    comparisons.push({
      metric: key,
      baseline: baselineValue,
      current: currentValue,
      threshold,
      delta,
      ratio,
      status: regressed ? "regressed" : "ok",
    });
  }

  const regressions = comparisons.filter((c) => c.status === "regressed");
  return {
    scenario: current?.scenario ?? baseline?.scenario ?? "unknown",
    fixture: current?.fixture ?? baseline?.fixture ?? "unknown",
    thresholdMultiplier: multiplier,
    minDeltaMs,
    minDeltaCount,
    comparisons,
    regressions,
    ok: regressions.length === 0,
  };
}

export function formatGateReport(result) {
  const lines = [];
  lines.push(
    `Perf gate: scenario=${result.scenario} fixture=${result.fixture} `
      + `threshold=${result.thresholdMultiplier}x `
      + `minDeltaMs=${result.minDeltaMs}`,
  );
  if (result.ok) {
    lines.push("Status: OK (no regressions)");
  } else {
    lines.push(`Status: REGRESSED (${result.regressions.length} metric(s))`);
  }
  lines.push("");
  lines.push(
    [
      "metric".padEnd(40),
      "baseline".padStart(12),
      "current".padStart(12),
      "threshold".padStart(12),
      "ratio".padStart(8),
      "status",
    ].join("  "),
  );
  for (const c of result.comparisons) {
    lines.push(
      [
        c.metric.padEnd(40),
        String(c.baseline ?? "-").padStart(12),
        String(c.current ?? "-").padStart(12),
        String(c.threshold ?? "-").padStart(12),
        String(c.ratio ?? "-").padStart(8),
        c.status,
      ].join("  "),
    );
  }
  if (!result.ok) {
    lines.push("");
    lines.push("Failures:");
    for (const c of result.regressions) {
      lines.push(
        `  - scenario=${result.scenario} fixture=${result.fixture} `
          + `metric=${c.metric} baseline=${c.baseline} current=${c.current} `
          + `threshold=${c.threshold} (${result.thresholdMultiplier}x)`,
      );
    }
  }
  return lines.join("\n");
}

export const PERF_GATE_DEFAULTS = Object.freeze({
  thresholdMultiplier: DEFAULT_THRESHOLD_MULTIPLIER,
  minDeltaMs: DEFAULT_MIN_DELTA_MS,
  minDeltaCount: DEFAULT_MIN_DELTA_COUNT,
});
