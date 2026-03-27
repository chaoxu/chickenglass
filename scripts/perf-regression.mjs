#!/usr/bin/env node

/* global window */

import console from "node:console";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  PERF_REPORT_VERSION,
  buildPerfRegressionReport,
  comparePerfRegressionReports,
} from "./perf-regression-lib.mjs";
import { connectEditor, openFile, switchToMode } from "./test-helpers.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";

const argv = process.argv.slice(2);
const hasExplicitCommand = argv[0] === "capture" || argv[0] === "compare";
const command = hasExplicitCommand ? argv[0] : "capture";
const options = hasExplicitCommand ? argv.slice(1) : argv;
const chromeArgs = parseChromeArgs(options);

function getFlag(flag, fallback = undefined) {
  const index = options.indexOf(flag);
  return index >= 0 && index + 1 < options.length ? options[index + 1] : fallback;
}

function getIntFlag(flag, fallback) {
  const value = getFlag(flag);
  return value ? parseInt(value, 10) : fallback;
}

function sleep(ms) {
  return delay(ms);
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

async function waitForDebugBridge(page) {
  await page.waitForFunction(() => {
    return Boolean(window.__app && window.__cfDebug && window.__cmView);
  });
}

async function clearPerf(page) {
  await page.evaluate(async () => {
    await window.__cfDebug.clearPerf();
  });
}

async function getPerfSnapshot(page) {
  return page.evaluate(async () => window.__cfDebug.perfSummary());
}

async function getSemanticRevisionInfo(page) {
  return page.evaluate(() => window.__cmDebug.semantics());
}

const scenarios = {
  "open-index": {
    description: "Reload the app and open demo/index.md in Rich mode.",
    defaultSettleMs: 400,
    run: async (page) => {
      await page.evaluate(() => window.__app.setMode("rich"));
      await openFile(page, "index.md");
    },
  },
  "open-heavy-post": {
    description: "Reload the app and open a heavy math/reference demo post.",
    defaultSettleMs: 700,
    run: async (page) => {
      await page.evaluate(() => window.__app.setMode("rich"));
      await openFile(page, "posts/2020-07-11-yotta-savings-and-covering-designs.md");
    },
  },
  "mode-cycle-index": {
    description: "Reload the app, open demo/index.md, then cycle Source/Read/Rich.",
    defaultSettleMs: 500,
    run: async (page) => {
      await page.evaluate(() => window.__app.setMode("rich"));
      await openFile(page, "index.md");
      await switchToMode(page, "source");
      await switchToMode(page, "read");
      await switchToMode(page, "rich");
    },
  },
  "local-edit-index": {
    description: "Reload the app, open demo/index.md, then apply a local inline-math edit.",
    defaultSettleMs: 300,
    run: async (page) => {
      await page.evaluate(() => window.__app.setMode("rich"));
      await openFile(page, "index.md");
      await page.waitForTimeout(800);
      const before = await getSemanticRevisionInfo(page);
      const after = await page.evaluate((previous) => {
        const view = window.__cmView;
        const docText = view.state.doc.toString();
        const inlineMath = /\$([^$\n]+)\$/.exec(docText);
        const body = inlineMath?.[1] ?? "";
        const matchIndex = inlineMath?.index ?? -1;
        const bodyOffset = body.search(/[A-Za-z0-9]/);
        const changeFrom = matchIndex >= 0
          ? matchIndex + 1 + (bodyOffset >= 0 ? bodyOffset : 0)
          : -1;

        if (changeFrom < 0) {
          throw new Error("Failed to locate an inline math fixture in index.md");
        }

        view.dispatch({
          changes: {
            from: changeFrom,
            to: changeFrom + 1,
            insert: "z",
          },
          selection: { anchor: changeFrom + 1 },
        });

        const next = window.__cmDebug.semantics();
        const changedSlices = Object.entries(next.slices)
          .filter(([name, value]) => value !== previous.slices[name])
          .map(([name]) => name);

        return {
          revisionDelta: next.revision - previous.revision,
          changedSlices,
        };
      }, before);

      return {
        metrics: [
          {
            name: "semantic.revision_delta",
            unit: "count",
            value: after.revisionDelta,
          },
          {
            name: "semantic.changed_slice_count",
            unit: "count",
            value: after.changedSlices.length,
          },
          ...[
            "headings",
            "footnotes",
            "fencedDivs",
            "equations",
            "mathRegions",
            "references",
            "includes",
          ].map((sliceName) => ({
            name: `semantic.slice.${sliceName}`,
            unit: "count",
            value: after.changedSlices.includes(sliceName) ? 1 : 0,
          })),
        ],
      };
    },
  },
};

function printUsage() {
  console.log(`Usage:
  npm run perf:capture -- --scenario open-index --output output/perf/open-index.json
  npm run perf:compare -- --scenario open-index --baseline output/perf/open-index.json

Options:
  --scenario <name>        One of: ${Object.keys(scenarios).join(", ")}
  --iterations <n>         Measured iterations (default: 3)
  --warmup <n>             Warmup iterations before capture (default: 1)
  --settle-ms <n>          Extra settle time after scenario (default: scenario-specific)
  --output <path>          Where to write the captured report (capture only)
  --baseline <path>        Baseline report to compare against (compare only)
  --threshold-pct <n>      Regression threshold percent (default: 25)
  --min-delta-ms <n>       Minimum absolute delta before flagging (default: 5)
  --port <n>               CDP port for Chrome for Testing (default: 9322)
  --url <url>              App URL that Chrome is already running against
`);
}

async function runScenarioSamples(page, scenarioName, iterations, warmup, settleMs) {
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioName}".`);
  }

  const snapshots = [];
  const totalRuns = warmup + iterations;

  for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
    await page.goto(chromeArgs.url, { waitUntil: "domcontentloaded" });
    await waitForDebugBridge(page);
    await clearPerf(page);
    const scenarioResult = await scenario.run(page);
    await sleep(settleMs);
    const snapshot = await getPerfSnapshot(page);
    if (runIndex >= warmup) {
      snapshots.push({
        ...snapshot,
        metrics: scenarioResult?.metrics ?? [],
      });
    }
  }

  return snapshots;
}

function printReportSummary(report) {
  const topFrontend = report.frontend.slice(0, 8).map((entry) => ({
    name: entry.name,
    avgMs: entry.meanAvgMs,
    maxMs: entry.worstMaxMs,
    samples: entry.samples,
  }));
  const topBackend = report.backend.slice(0, 8).map((entry) => ({
    name: entry.name,
    avgMs: entry.meanAvgMs,
    maxMs: entry.worstMaxMs,
    samples: entry.samples,
  }));

  console.log(`Scenario: ${report.scenario}`);
  console.log(`Iterations: ${report.iterations} (warmup ${report.warmup})`);
  console.log(`Captured at: ${report.capturedAt}`);
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
      max: entry.maxValue,
      samples: entry.samples,
    })));
  }
}

function printComparison(result) {
  const spanRegressions = [...result.frontend, ...result.backend]
    .filter((entry) => entry.status === "regressed")
    .map((entry) => ({
    source: entry.source,
    name: entry.name,
    avgDeltaMs: entry.avgDeltaMs,
    avgPct: `${entry.avgPct}%`,
    maxDeltaMs: entry.maxDeltaMs,
    maxPct: `${entry.maxPct}%`,
    }));

  if (spanRegressions.length === 0) {
    console.log("No perf regressions detected.");
    const metricRegressions = result.metrics?.filter((entry) => entry.status === "regressed") ?? [];
    if (metricRegressions.length === 0) {
      return;
    }
  }

  const metricRegressions = (result.metrics ?? [])
    .filter((entry) => entry.status === "regressed")
    .map((entry) => ({
      source: "metric",
      name: entry.name,
      avgDeltaMs: entry.meanDelta,
      avgPct: `${entry.meanPct}%`,
      maxDeltaMs: entry.maxDelta,
      maxPct: `${entry.maxPct}%`,
    }));

  if (spanRegressions.length === 0 && metricRegressions.length === 0) {
    return;
  }

  console.log("Perf regressions detected:");
  console.table([...spanRegressions, ...metricRegressions]);
}

async function main() {
  if (options.includes("--help") || options.includes("-h")) {
    printUsage();
    return;
  }

  const scenarioName = getFlag("--scenario", "open-index");
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    printUsage();
    process.exit(1);
  }

  const iterations = getIntFlag("--iterations", 3);
  const warmup = getIntFlag("--warmup", 1);
  const settleMs = getIntFlag("--settle-ms", scenario.defaultSettleMs);

  const page = await connectEditor(chromeArgs.port);
  try {
    const snapshots = await runScenarioSamples(page, scenarioName, iterations, warmup, settleMs);
    const report = buildPerfRegressionReport({
      scenario: scenarioName,
      iterations,
      warmup,
      settleMs,
      chromePort: chromeArgs.port,
      appUrl: chromeArgs.url,
      snapshots,
    });

    if (command === "capture") {
      const outputPath = getFlag("--output");
      if (outputPath) {
        const resolved = resolve(outputPath);
        ensureDir(resolved);
        writeFileSync(resolved, JSON.stringify(report, null, 2) + "\n");
        console.log(`Wrote perf baseline to ${resolved}`);
      }
      printReportSummary(report);
      return;
    }

    if (command === "compare") {
      const baselinePath = getFlag("--baseline");
      if (!baselinePath) {
        throw new Error("--baseline is required for compare");
      }

      const baseline = JSON.parse(readFileSync(resolve(baselinePath), "utf8"));
      if (baseline.version !== PERF_REPORT_VERSION) {
        throw new Error(
          `Unsupported perf baseline version ${baseline.version}; expected ${PERF_REPORT_VERSION}.`,
        );
      }
      if (baseline.scenario !== scenarioName) {
        throw new Error(
          `Baseline scenario "${baseline.scenario}" does not match requested scenario "${scenarioName}".`,
        );
      }

      const comparison = comparePerfRegressionReports(baseline, report, {
        thresholdPct: getIntFlag("--threshold-pct", 25) / 100,
        minDeltaMs: getIntFlag("--min-delta-ms", 5),
      });
      printReportSummary(report);
      console.log("");
      printComparison(comparison);
      if (comparison.regressions.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    throw new Error(`Unknown command "${command}"`);
  } finally {
    await page.context().browser()?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
