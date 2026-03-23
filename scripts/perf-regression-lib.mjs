export const PERF_REPORT_VERSION = 1;

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

export function buildPerfRegressionReport({
  scenario,
  iterations,
  warmup,
  settleMs,
  snapshots,
  chromePort,
  appUrl,
}) {
  const frontendEntries = [];
  const backendEntries = [];

  for (const snapshot of snapshots) {
    frontendEntries.push(...(snapshot.frontend?.summaries ?? []));
    backendEntries.push(...(snapshot.backend?.summaries ?? []));
  }

  return {
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
  };
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
  const regressions = [...frontend, ...backend].filter((entry) => entry.status === "regressed");

  return {
    thresholdPct,
    minDeltaMs,
    frontend,
    backend,
    regressions,
  };
}
