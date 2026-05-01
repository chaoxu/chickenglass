// Pure helpers for transforming a perf-regression report into a flat
// dashboard JSON snapshot. No I/O so the logic is unit-testable.

const TYPING_METRIC_BASES = [
  "typing.dispatch_mean_ms",
  "typing.dispatch_p95_ms",
  "typing.dispatch_max_ms",
  "typing.input_to_idle_ms",
  "typing.input_to_idle_per_char_ms",
  "typing.wall_ms",
  "typing.wall_per_char_ms",
  "typing.settle_ms",
  "typing.idle_ms",
  "typing.longtask_count",
  "typing.longtask_total_ms",
  "typing.longtask_max_ms",
  "typing.post_idle_longtask_count",
  "typing.post_idle_longtask_total_ms",
  "typing.post_idle_longtask_max_ms",
  "typing.post_idle_lag_mean_ms",
  "typing.post_idle_lag_p95_ms",
  "typing.post_idle_lag_max_ms",
];

// Aggregator for each metric base: how to combine its meanValue / maxValue
// across all (case, position) pairs into a single dashboard number.
// "max-of-mean" -> the worst hotspot's typical value (what we usually want
// for a dashboard). "sum" -> totals (long task counts).
const AGGREGATORS = {
  "typing.dispatch_mean_ms": "max-of-mean",
  "typing.dispatch_p95_ms": "max-of-mean",
  "typing.dispatch_max_ms": "max-of-max",
  "typing.input_to_idle_ms": "max-of-mean",
  "typing.input_to_idle_per_char_ms": "max-of-mean",
  "typing.wall_ms": "max-of-mean",
  "typing.wall_per_char_ms": "max-of-mean",
  "typing.settle_ms": "max-of-mean",
  "typing.idle_ms": "max-of-mean",
  "typing.longtask_count": "sum-of-mean",
  "typing.longtask_total_ms": "sum-of-mean",
  "typing.longtask_max_ms": "max-of-max",
  "typing.post_idle_longtask_count": "sum-of-mean",
  "typing.post_idle_longtask_total_ms": "sum-of-mean",
  "typing.post_idle_longtask_max_ms": "max-of-max",
  "typing.post_idle_lag_mean_ms": "max-of-mean",
  "typing.post_idle_lag_p95_ms": "max-of-mean",
  "typing.post_idle_lag_max_ms": "max-of-max",
};

function roundTo(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function aggregate(entries, mode) {
  if (entries.length === 0) return 0;
  switch (mode) {
    case "max-of-mean":
      return entries.reduce((acc, e) => Math.max(acc, e.meanValue ?? 0), 0);
    case "max-of-max":
      return entries.reduce((acc, e) => Math.max(acc, e.maxValue ?? 0), 0);
    case "sum-of-mean":
      return entries.reduce((acc, e) => acc + (e.meanValue ?? 0), 0);
    default:
      return entries[0]?.meanValue ?? 0;
  }
}

// Build a flat metrics object keyed by metric base. Returns sorted-key object.
export function buildDashboardMetrics(report) {
  const metrics = report?.metrics ?? [];
  const result = {};
  for (const base of TYPING_METRIC_BASES) {
    const matches = metrics.filter(
      (m) => m.name === base || m.name.startsWith(`${base}.`),
    );
    const mode = AGGREGATORS[base] ?? "max-of-mean";
    const value = aggregate(matches, mode);
    result[base] = roundTo(value);
  }
  return sortKeys(result);
}

function sortKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

export function buildDashboardSnapshot({ report, commit, fixture }) {
  const snapshot = {
    capturedAt: report.capturedAt ?? new Date().toISOString(),
    commit: commit ?? "unknown",
    fixture: fixture ?? "unknown",
    iterations: report.iterations ?? 0,
    metrics: buildDashboardMetrics(report),
    scenario: report.scenario ?? "unknown",
    warmup: report.warmup ?? 0,
  };
  return sortKeys(snapshot);
}

// Stable JSON: sorted keys at every level (we already sort top-level and
// metrics; nothing else nests).
export function stableStringify(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export const DASHBOARD_METRIC_KEYS = Object.freeze([...TYPING_METRIC_BASES]);
