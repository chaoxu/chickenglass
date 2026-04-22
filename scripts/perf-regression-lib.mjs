export const PERF_REPORT_VERSION = 3;

function roundMs(value) {
  return Number(value.toFixed(3));
}

function aggregateSnapshotEntries(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = `${entry.source}:${entry.category}:${entry.name}`;
    const group = grouped.get(key) ?? {
      source: entry.source,
      category: entry.category,
      name: entry.name,
      samples: 0,
      totalAvgMs: 0,
      worstMaxMs: 0,
      totalLastMs: 0,
      totalCount: 0,
    };

    group.samples += 1;
    group.totalAvgMs += entry.avgMs;
    group.worstMaxMs = Math.max(group.worstMaxMs, entry.maxMs);
    group.totalLastMs += entry.lastMs;
    group.totalCount += entry.count;
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      source: group.source,
      category: group.category,
      name: group.name,
      samples: group.samples,
      meanAvgMs: roundMs(group.totalAvgMs / group.samples),
      worstMaxMs: roundMs(group.worstMaxMs),
      meanLastMs: roundMs(group.totalLastMs / group.samples),
      meanCount: roundMs(group.totalCount / group.samples),
    }))
    .sort((left, right) => right.meanAvgMs - left.meanAvgMs);
}

function aggregateMetricEntries(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = `${entry.name}:${entry.unit ?? "count"}`;
    const group = grouped.get(key) ?? {
      name: entry.name,
      unit: entry.unit ?? "count",
      samples: 0,
      totalValue: 0,
      maxValue: 0,
    };

    group.samples += 1;
    group.totalValue += entry.value;
    group.maxValue = Math.max(group.maxValue, entry.value);
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      name: group.name,
      unit: group.unit,
      samples: group.samples,
      meanValue: roundMs(group.totalValue / group.samples),
      maxValue: roundMs(group.maxValue),
    }))
    .sort((left, right) => right.meanValue - left.meanValue);
}

function validateRequiredMetrics(metrics, requiredMetrics, expectedSamples) {
  const uniqueRequiredMetrics = [...new Set(requiredMetrics)].sort();
  if (uniqueRequiredMetrics.length === 0) {
    return;
  }

  const metricsByName = new Map(metrics.map((entry) => [entry.name, entry]));
  const failures = [];

  for (const name of uniqueRequiredMetrics) {
    const metric = metricsByName.get(name);
    if (!metric) {
      failures.push(`${name} (missing)`);
      continue;
    }
    if (metric.samples !== expectedSamples) {
      failures.push(`${name} (samples ${metric.samples}/${expectedSamples})`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Missing required perf metrics: ${failures.join(", ")}`);
  }
}

export function buildPerfRegressionReport({
  scenario,
  iterations,
  warmup,
  settleMs,
  snapshots,
  metrics = [],
  requiredMetrics = [],
  chromePort,
  appUrl,
}) {
  const frontendEntries = [];
  const backendEntries = [];
  const metricEntries = [];

  for (const snapshot of snapshots) {
    frontendEntries.push(...(snapshot.frontend?.summaries ?? []));
    backendEntries.push(...(snapshot.backend?.summaries ?? []));
    metricEntries.push(...(snapshot.metrics ?? []));
  }

  const report = {
    version: PERF_REPORT_VERSION,
    capturedAt: new Date().toISOString(),
    scenario,
    iterations,
    warmup,
    settleMs,
    chromePort,
    appUrl,
    frontend: aggregateSnapshotEntries(frontendEntries),
    backend: aggregateSnapshotEntries(backendEntries),
    metrics: aggregateMetricEntries([...metricEntries, ...metrics]),
    requiredMetrics: [...new Set(requiredMetrics)].sort(),
  };

  validateRequiredMetrics(report.metrics, report.requiredMetrics, iterations);
  return report;
}

function compareEntrySets(baselineEntries, currentEntries, thresholdPct, minDeltaMs) {
  const currentByKey = new Map(
    currentEntries.map((entry) => [`${entry.source}:${entry.category}:${entry.name}`, entry]),
  );
  const comparisons = [];

  for (const baseline of baselineEntries) {
    const key = `${baseline.source}:${baseline.category}:${baseline.name}`;
    const current = currentByKey.get(key);
    if (!current) {
      comparisons.push({
        key,
        source: baseline.source,
        category: baseline.category,
        name: baseline.name,
        status: "missing",
        baseline,
        current: null,
      });
      continue;
    }

    const avgDeltaMs = roundMs(current.meanAvgMs - baseline.meanAvgMs);
    const maxDeltaMs = roundMs(current.worstMaxMs - baseline.worstMaxMs);
    const avgPct = baseline.meanAvgMs > 0
      ? (current.meanAvgMs - baseline.meanAvgMs) / baseline.meanAvgMs
      : 0;
    const maxPct = baseline.worstMaxMs > 0
      ? (current.worstMaxMs - baseline.worstMaxMs) / baseline.worstMaxMs
      : 0;
    const avgRegressed = avgDeltaMs > minDeltaMs && avgPct > thresholdPct;
    const maxRegressed = maxDeltaMs > minDeltaMs && maxPct > thresholdPct;

    comparisons.push({
      key,
      source: baseline.source,
      category: baseline.category,
      name: baseline.name,
      status: avgRegressed || maxRegressed ? "regressed" : "ok",
      avgDeltaMs,
      maxDeltaMs,
      avgPct: roundMs(avgPct * 100),
      maxPct: roundMs(maxPct * 100),
      baseline,
      current,
    });
  }

  return comparisons;
}

function compareMetricSets(baselineEntries, currentEntries, thresholdPct, minDeltaMs) {
  const currentByKey = new Map(
    currentEntries.map((entry) => [`${entry.name}:${entry.unit ?? "count"}`, entry]),
  );
  const comparisons = [];

  for (const baseline of baselineEntries) {
    const key = `${baseline.name}:${baseline.unit ?? "count"}`;
    const current = currentByKey.get(key);
    if (!current) {
      comparisons.push({
        key,
        name: baseline.name,
        unit: baseline.unit ?? "count",
        status: "missing",
        baseline,
        current: null,
      });
      continue;
    }

    const unit = baseline.unit ?? "count";
    const minDelta = unit === "ms" ? minDeltaMs : 0;
    const meanDelta = roundMs(current.meanValue - baseline.meanValue);
    const maxDelta = roundMs(current.maxValue - baseline.maxValue);
    const meanPct = baseline.meanValue > 0
      ? (current.meanValue - baseline.meanValue) / baseline.meanValue
      : (meanDelta > 0 ? 1 : 0);
    const maxPct = baseline.maxValue > 0
      ? (current.maxValue - baseline.maxValue) / baseline.maxValue
      : (maxDelta > 0 ? 1 : 0);
    const meanRegressed = meanDelta > minDelta && meanPct > thresholdPct;
    const maxRegressed = maxDelta > minDelta && maxPct > thresholdPct;

    comparisons.push({
      key,
      name: baseline.name,
      unit: baseline.unit ?? "count",
      status: meanRegressed || maxRegressed ? "regressed" : "ok",
      meanDelta,
      maxDelta,
      meanPct: roundMs(meanPct * 100),
      maxPct: roundMs(maxPct * 100),
      baseline,
      current,
    });
  }

  return comparisons;
}

export function comparePerfRegressionReports(
  baselineReport,
  currentReport,
  options = {},
) {
  const thresholdPct = options.thresholdPct ?? 25 / 100;
  const minDeltaMs = options.minDeltaMs ?? 5;
  const frontend = compareEntrySets(
    baselineReport.frontend ?? [],
    currentReport.frontend ?? [],
    thresholdPct,
    minDeltaMs,
  );
  const backend = compareEntrySets(
    baselineReport.backend ?? [],
    currentReport.backend ?? [],
    thresholdPct,
    minDeltaMs,
  );
  const metrics = compareMetricSets(
    baselineReport.metrics ?? [],
    currentReport.metrics ?? [],
    thresholdPct,
    minDeltaMs,
  );
  const regressions = [...frontend, ...backend, ...metrics].filter((entry) =>
    entry.status === "regressed" || entry.status === "missing"
  );

  return {
    thresholdPct,
    minDeltaMs,
    frontend,
    backend,
    metrics,
    regressions,
  };
}
