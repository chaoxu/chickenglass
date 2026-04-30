import console from "node:console";

export function printReportSummary(report) {
  const answerRows = performanceAnswerRows(report);
  const actionableRows = actionablePerfSummaryRows(report);
  const topFrontend = report.frontend.slice(0, 8).map((entry) => ({
    name: entry.name,
    avgMs: entry.meanAvgMs,
    p95Ms: entry.p95AvgMs,
    maxMs: entry.worstMaxMs,
    samples: entry.samples,
  }));
  const topBackend = report.backend.slice(0, 8).map((entry) => ({
    name: entry.name,
    avgMs: entry.meanAvgMs,
    p95Ms: entry.p95AvgMs,
    maxMs: entry.worstMaxMs,
    samples: entry.samples,
  }));

  console.log(`Scenario: ${report.scenario}`);
  console.log(`Iterations: ${report.iterations} (warmup ${report.warmup})`);
  console.log(`Captured at: ${report.capturedAt}`);
  if (answerRows.length > 0) {
    console.log("\nPerformance answer table");
    console.table(answerRows);
  }
  if (actionableRows.length > 0) {
    console.log("\nActionable summary");
    console.table(actionableRows.map((entry) => ({
      source: entry.source,
      bucket: entry.bucket,
      name: entry.name,
      valueMs: entry.value,
      p95Ms: entry.p95,
      owner: entry.owner,
    })));
  }
  if (topFrontend.length > 0) {
    console.log("\nFrontend spans");
    console.table(topFrontend);
  }
  if (topBackend.length > 0) {
    console.log("\nBackend spans");
    console.table(topBackend);
  }
  if ((report.metrics ?? []).length > 0) {
    console.log("\nScenario metrics");
    console.table(report.metrics.slice(0, 12).map((entry) => ({
      name: entry.name,
      unit: entry.unit,
      mean: entry.meanValue,
      p50: entry.p50Value,
      p95: entry.p95Value,
      max: entry.maxValue,
      samples: entry.samples,
    })));
  }
}

function metricByName(report) {
  return new Map((report.metrics ?? []).map((entry) => [entry.name, entry]));
}

function metric(metrics, name) {
  return metrics.get(name) ?? null;
}

function metricP95(metrics, name) {
  return metric(metrics, name)?.p95Value ?? null;
}

function metricMean(metrics, name) {
  return metric(metrics, name)?.meanValue ?? null;
}

function metricMax(metrics, name) {
  return metric(metrics, name)?.maxValue ?? null;
}

function roundAnswerValue(value) {
  if (value === null || value === undefined) return "";
  return Number(value.toFixed(3));
}

function splitScopedMetricName(name, metricPrefix) {
  const prefix = `${metricPrefix}.`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const firstDot = rest.indexOf(".");
  if (firstDot < 0) return null;
  const caseKey = rest.slice(0, firstDot);
  const positionKey = rest.slice(firstDot + 1);
  if (!caseKey || !positionKey) return null;
  return { caseKey, positionKey };
}

function typingGroups(metrics, prefix) {
  const groups = new Map();
  for (const entry of metrics.values()) {
    const scope = splitScopedMetricName(entry.name, `${prefix}.insert_count`);
    if (!scope) continue;
    const key = `${scope.caseKey}.${scope.positionKey}`;
    groups.set(key, scope);
  }
  return [...groups.values()].sort((left, right) =>
    left.caseKey.localeCompare(right.caseKey)
    || left.positionKey.localeCompare(right.positionKey)
  );
}

function cm6TypingAnswerRows(metrics) {
  return typingGroups(metrics, "typing").map(({ caseKey, positionKey }) => {
    const scoped = (name) => `${name}.${caseKey}.${positionKey}`;
    return {
      surface: "CM6 Rich",
      document: caseKey,
      position: positionKey,
      inserts: roundAnswerValue(metricMean(metrics, scoped("typing.insert_count"))),
      dispatchP95Ms: roundAnswerValue(metricP95(metrics, scoped("typing.dispatch_p95_ms"))),
      dispatchMaxMs: roundAnswerValue(metricMax(metrics, scoped("typing.dispatch_max_ms"))),
      donePerCharP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("typing.input_to_idle_per_char_ms")),
      ),
      doneTotalP95Ms: roundAnswerValue(metricP95(metrics, scoped("typing.input_to_idle_ms"))),
      longTasksP95: roundAnswerValue(metricP95(metrics, scoped("typing.longtask_count"))),
      postIdleLagP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("typing.post_idle_lag_p95_ms")),
      ),
    };
  });
}

function lexicalTypingAnswerRows(metrics) {
  return typingGroups(metrics, "lexical.typing").map(({ caseKey, positionKey }) => {
    const scoped = (name) => `${name}.${caseKey}.${positionKey}`;
    return {
      surface: "Lexical",
      document: caseKey,
      position: positionKey,
      inserts: roundAnswerValue(metricMean(metrics, scoped("lexical.typing.insert_count"))),
      insertP95Ms: roundAnswerValue(metricP95(metrics, scoped("lexical.typing.insert_p95_ms"))),
      insertMaxMs: roundAnswerValue(metricMax(metrics, scoped("lexical.typing.insert_max_ms"))),
      donePerCharP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("lexical.typing.input_to_semantic_per_char_ms")),
      ),
      doneTotalP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("lexical.typing.input_to_semantic_ms")),
      ),
      semanticWorkP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("lexical.typing.semantic_work_ms")),
      ),
      longTasksP95: roundAnswerValue(
        metricP95(metrics, scoped("lexical.typing.longtask_count")),
      ),
      postIdleLagP95Ms: roundAnswerValue(
        metricP95(metrics, scoped("lexical.typing.post_idle_lag_p95_ms")),
      ),
    };
  });
}

function scrollAnswerRows(metrics, scenario) {
  if (!scenario.startsWith("scroll-")) return [];
  if (scenario === "scroll-jump-rich") {
    return [{
      surface: "CM6 Rich",
      scenario,
      coldJumpP95Ms: roundAnswerValue(metricP95(metrics, "scroll.cold_jump_ms")),
      warmBackP95Ms: roundAnswerValue(metricP95(metrics, "scroll.warm_back_ms")),
      warmForwardP95Ms: roundAnswerValue(metricP95(metrics, "scroll.warm_forward_ms")),
    }];
  }
  return [{
    surface: scenario.endsWith("source") ? "Source" : "CM6 Rich",
    scenario,
    steps: roundAnswerValue(metricMean(metrics, "scroll.step_count")),
    meanStepP95Ms: roundAnswerValue(metricP95(metrics, "scroll.mean_step_ms")),
    maxStepMs: roundAnswerValue(metricMax(metrics, "scroll.max_step_ms")),
    totalP95Ms: roundAnswerValue(metricP95(metrics, "scroll.total_ms")),
  }];
}

export function performanceAnswerRows(report) {
  const metrics = metricByName(report);
  if (report.scenario === "typing-rich-burst") {
    return cm6TypingAnswerRows(metrics);
  }
  if (report.scenario === "typing-lexical-bridge-burst") {
    return lexicalTypingAnswerRows(metrics);
  }
  if (report.scenario?.startsWith("scroll-")) {
    return scrollAnswerRows(metrics, report.scenario);
  }
  return [];
}

export function comparisonFailureRows(result) {
  const spanRegressions = [...result.frontend, ...result.backend]
    .filter((entry) => entry.status === "regressed" || entry.status === "missing")
    .map((entry) => ({
      source: entry.source,
      name: entry.name,
      status: entry.status,
      avgDeltaMs: entry.status === "missing" ? "missing" : entry.avgDeltaMs,
      avgPct: entry.status === "missing" ? "missing" : `${entry.avgPct}%`,
      maxDeltaMs: entry.status === "missing" ? "missing" : entry.maxDeltaMs,
      maxPct: entry.status === "missing" ? "missing" : `${entry.maxPct}%`,
    }));

  const metricRegressions = (result.metrics ?? [])
    .filter((entry) => entry.status === "regressed" || entry.status === "missing")
    .map((entry) => ({
      source: "metric",
      name: entry.name,
      status: entry.status,
      avgDeltaMs: entry.status === "missing" ? "missing" : entry.meanDelta,
      avgPct: entry.status === "missing" ? "missing" : `${entry.meanPct}%`,
      maxDeltaMs: entry.status === "missing" ? "missing" : entry.maxDelta,
      maxPct: entry.status === "missing" ? "missing" : `${entry.maxPct}%`,
    }));

  return [...spanRegressions, ...metricRegressions];
}

const PERF_OWNER_HINTS = [
  {
    bucket: "hot-path typing",
    owner: "src/lexical/incremental-rich-sync.ts",
    test: (name) => name.startsWith("lexical.incrementalRichSync"),
  },
  {
    bucket: "hot-path typing",
    owner: "src/lexical/use-deferred-rich-document-sync.ts",
    test: (name) => name.startsWith("lexical.typing."),
  },
  {
    bucket: "semantic tail",
    owner: "src/lexical/lexical-editor-pane.tsx",
    test: (name) =>
      name.startsWith("lexical.deriveSemanticState")
      || name.startsWith("lexical.createSourceSpanIndex"),
  },
  {
    bucket: "sidebar/background work",
    owner: "src/app/components/sidebar-semantic-state.ts",
    test: (name) => name.startsWith("lexical.sidebar_open."),
  },
  {
    bucket: "hot-path typing",
    owner: "src/editor/",
    test: (name) => name.startsWith("typing."),
  },
  {
    bucket: "semantic tail",
    owner: "src/semantics/",
    test: (name) =>
      name.startsWith("cm6.documentAnalysis")
      || name.includes(".documentAnalysis."),
  },
  {
    bucket: "render/scroll",
    owner: "src/render/",
    test: (name) => name.startsWith("scroll.") || name.includes("markdownRender"),
  },
  {
    bucket: "export",
    owner: "src-tauri/src/commands/export.rs",
    test: (name) => name.startsWith("export.html."),
  },
  {
    bucket: "citation setup",
    owner: "src/citations/",
    test: (name) => name.startsWith("citations."),
  },
];

export function perfOwnerHint(name) {
  return PERF_OWNER_HINTS.find((hint) => hint.test(name)) ?? {
    bucket: "unclassified",
    owner: "",
  };
}

export function actionablePerfSummaryRows(report, { limit = 8 } = {}) {
  const spanRows = [...(report.frontend ?? []), ...(report.backend ?? [])]
    .filter((entry) => typeof entry.meanAvgMs === "number")
    .sort((left, right) => right.meanAvgMs - left.meanAvgMs)
    .slice(0, limit)
    .map((entry) => {
      const hint = perfOwnerHint(entry.name);
      return {
        bucket: hint.bucket,
        name: entry.name,
        owner: hint.owner,
        p95: entry.p95AvgMs,
        source: entry.source,
        value: entry.meanAvgMs,
      };
    });
  const metricRows = (report.metrics ?? [])
    .filter((entry) => entry.unit === "ms" && typeof entry.meanValue === "number")
    .sort((left, right) => right.meanValue - left.meanValue)
    .slice(0, limit)
    .map((entry) => {
      const hint = perfOwnerHint(entry.name);
      return {
        bucket: hint.bucket,
        name: entry.name,
        owner: hint.owner,
        p95: entry.p95Value,
        source: "metric",
        value: entry.meanValue,
      };
    });

  return [...spanRows, ...metricRows]
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

export function printComparison(result) {
  const rows = comparisonFailureRows(result);
  if (rows.length === 0) {
    console.log("No perf regressions detected.");
    return;
  }

  console.log("Perf regressions or missing measurements detected:");
  console.table(rows.map((row) => {
    const hint = perfOwnerHint(row.name);
    return {
      ...row,
      bucket: hint.bucket,
      owner: hint.owner,
    };
  }));
}
