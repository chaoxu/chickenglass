#!/usr/bin/env node

/* global window */

import console from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  PERF_REPORT_VERSION,
  buildPerfRegressionReport,
  comparePerfRegressionReports,
} from "./perf-regression-lib.mjs";
import {
  assertEditorHealth,
  connectEditor,
  createArgParser,
  disconnectBrowser,
  EXTERNAL_DEMO_ROOT,
  EXTERNAL_FIXTURE_ROOT,
  hasFixtureDocument,
  openFixtureDocument,
  PUBLIC_SHOWCASE_FIXTURE,
  resolveFixtureDocumentWithFallback,
  sleep,
  switchToMode,
  waitForDebugBridge,
} from "./test-helpers.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

async function evaluateStep(page, label, callback, arg) {
  try {
    return await page.evaluate(callback, arg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

async function clearPerf(page) {
  await evaluateStep(page, "clearPerf", async () => {
    await window.__cfDebug.clearPerf();
  });
}

async function getPerfSnapshot(page) {
  return evaluateStep(page, "getPerfSnapshot", async () => window.__cfDebug.perfSummary());
}

async function getSemanticRevisionInfo(page) {
  return page.evaluate(() => window.__cmDebug.semantics());
}

async function discardDirtyPerfState(page) {
  try {
    await page.evaluate(async () => {
      const app = window.__app;
      if (!app?.closeFile) {
        return;
      }
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore cleanup failures — the next run will reload from scratch.
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Execution context was destroyed")) {
      throw error;
    }
  }
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SCROLL_STEP_SIZE = 30;
const SCROLL_FIXTURE = {
  displayPath: "fixtures/cogirth/main2.md",
  virtualPath: "cogirth/main2.md",
  candidates: [
    resolve(REPO_ROOT, "fixtures/cogirth/main2.md"),
    resolve(EXTERNAL_FIXTURE_ROOT, "cogirth/main2.md"),
  ],
};
const PUBLIC_SCROLL_FALLBACK = PUBLIC_SHOWCASE_FIXTURE;

export const TYPING_BURST_REQUIRED_METRICS = [
  "typing.wall_ms",
  "typing.dispatch_mean_ms",
  "typing.dispatch_max_ms",
  "typing.settle_ms",
];

const DEFAULT_TYPING_BURST_POSITION_KEYS = ["after_frontmatter", "near_end"];

async function runSteppedScroll(page) {
  return page.evaluate(async (stepSize) => {
    const view = window.__cmView;
    const totalLines = view.state.doc.lines;
    const steps = [];
    for (let line = 1 + stepSize; line <= totalLines; line += stepSize) {
      const target = Math.min(line, totalLines);
      const lineObj = view.state.doc.line(target);
      const t0 = performance.now();
      view.dispatch({ selection: { anchor: lineObj.from }, scrollIntoView: true });
      steps.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 16));
    }
    const total = steps.reduce((a, b) => a + b, 0);
    return {
      stepCount: steps.length,
      meanStepMs: total / (steps.length || 1),
      maxStepMs: Math.max(...steps, 0),
      totalMs: total,
    };
  }, SCROLL_STEP_SIZE);
}

function steppedScrollMetrics(result) {
  return [
    { name: "scroll.step_count", unit: "count", value: result.stepCount },
    { name: "scroll.mean_step_ms", unit: "ms", value: result.meanStepMs },
    { name: "scroll.max_step_ms", unit: "ms", value: result.maxStepMs },
    { name: "scroll.total_ms", unit: "ms", value: result.totalMs },
  ];
}

export const TYPING_BURST_CASES = [
  {
    key: "index",
    displayPath: "demo/index.md",
    virtualPath: "index.md",
    positionKeys: DEFAULT_TYPING_BURST_POSITION_KEYS,
    candidates: [
      resolve(REPO_ROOT, "demo/index.md"),
      resolve(EXTERNAL_DEMO_ROOT, "index.md"),
    ],
  },
  {
    key: "rankdecrease",
    displayPath: "fixtures/rankdecrease/main.md",
    virtualPath: "rankdecrease/main.md",
    positionKeys: DEFAULT_TYPING_BURST_POSITION_KEYS,
    candidates: [
      resolve(REPO_ROOT, "fixtures/rankdecrease/main.md"),
      resolve(EXTERNAL_FIXTURE_ROOT, "rankdecrease/main.md"),
    ],
  },
  {
    key: "cogirth_main2",
    displayPath: "fixtures/cogirth/main2.md",
    virtualPath: "cogirth/main2.md",
    positionKeys: [
      ...DEFAULT_TYPING_BURST_POSITION_KEYS,
      "inline_math",
      "citation_ref",
    ],
    candidates: [
      resolve(REPO_ROOT, "fixtures/cogirth/main2.md"),
      resolve(EXTERNAL_FIXTURE_ROOT, "cogirth/main2.md"),
    ],
  },
];
const TYPING_BURST_INSERT_COUNT = 100;

export function availableTypingBurstCases(caseDefinitions = TYPING_BURST_CASES) {
  return caseDefinitions.filter((caseDef) => hasFixtureDocument(caseDef));
}

function splitLinesWithOffsets(text) {
  const lines = text.split("\n");
  const result = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    result.push({
      number: i + 1,
      text: line,
      from: offset,
      to: offset + line.length,
    });
    offset += line.length + 1;
  }
  return result;
}

function isPlainProseLine(line) {
  const text = line.text.trim();
  if (!text) return false;
  if (/^(---|:::|```|~~~|\$\$|\\\[|\\\]|#|>|[-*+]\s|\d+\.\s|\|)/.test(text)) return false;
  return /[A-Za-z]/.test(text[0] ?? text);
}

function findFrontmatterEnd(lines) {
  if ((lines[0]?.text ?? "") !== "---") return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].text === "---") return i + 1;
  }
  return 0;
}

function pickAnchor(line) {
  const firstLetter = line.text.search(/[A-Za-z]/);
  const base = firstLetter >= 0 ? firstLetter : 0;
  return line.from + Math.min(base + 8, Math.max(line.text.length - 1, 0));
}

function findPatternPosition(lines, frontmatterEnd, positionKey, pattern, options = {}) {
  const groupIndex = options.groupIndex ?? 0;
  const charPattern = options.charPattern ?? /[A-Za-z0-9]/;

  for (let i = frontmatterEnd; i < lines.length; i += 1) {
    const line = lines[i];
    // Callers pass non-global regexes here. `RegExp.prototype.exec()` would be
    // stateful across lines only if the pattern used the `g` flag.
    const match = pattern.exec(line.text);
    if (!match || match.index < 0) {
      continue;
    }

    const anchorText = match[groupIndex] ?? match[0];
    const groupOffset = groupIndex > 0 ? match[0].indexOf(anchorText) : 0;
    const charOffset = anchorText.search(charPattern);
    return {
      line: line.number,
      anchor: line.from + match.index + groupOffset + (charOffset >= 0 ? charOffset : 0),
    };
  }

  throw new Error(`Failed to find ${positionKey} typing benchmark position.`);
}

const TYPING_BURST_POSITION_RESOLVERS = {
  after_frontmatter: ({ lines, frontmatterEnd }) => {
    for (let i = frontmatterEnd; i < lines.length; i += 1) {
      if (isPlainProseLine(lines[i])) {
        return {
          line: lines[i].number,
          anchor: pickAnchor(lines[i]),
        };
      }
    }
    throw new Error("Failed to find after_frontmatter typing benchmark position.");
  },
  near_end: ({ lines, frontmatterEnd }) => {
    for (let i = lines.length - 1; i >= frontmatterEnd; i -= 1) {
      if (isPlainProseLine(lines[i])) {
        return {
          line: lines[i].number,
          anchor: pickAnchor(lines[i]),
        };
      }
    }
    throw new Error("Failed to find near_end typing benchmark position.");
  },
  inline_math: ({ lines, frontmatterEnd }) =>
    findPatternPosition(
      lines,
      frontmatterEnd,
      "inline_math",
      /\$([^$\n]+)\$/,
      { groupIndex: 1, charPattern: /[A-Za-z0-9\\]/ },
    ),
  citation_ref: ({ lines, frontmatterEnd }) =>
    findPatternPosition(
      lines,
      frontmatterEnd,
      "citation_ref",
      /\[@([^\]]+)\]/,
      { groupIndex: 1, charPattern: /[A-Za-z0-9:_-]/ },
    ),
};

export function findTypingBurstPositions(text, positionKeys = DEFAULT_TYPING_BURST_POSITION_KEYS) {
  const lines = splitLinesWithOffsets(text);
  const frontmatterEnd = findFrontmatterEnd(lines);
  const context = {
    lines,
    frontmatterEnd,
  };
  const positions = {};

  for (const positionKey of positionKeys) {
    const resolver = TYPING_BURST_POSITION_RESOLVERS[positionKey];
    if (!resolver) {
      throw new Error(`Unknown typing benchmark position "${positionKey}".`);
    }
    positions[positionKey] = resolver(context);
  }

  return positions;
}

function resolveTypingBurstFixture(caseDef) {
  const resolvedPath = caseDef.candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(
      `Missing typing benchmark fixture for ${caseDef.displayPath}. Tried: ${caseDef.candidates.join(", ")}`,
    );
  }

  return {
    ...caseDef,
    content: readFileSync(resolvedPath, "utf8"),
  };
}

function resolveScrollFixture() {
  return resolveFixtureDocumentWithFallback(SCROLL_FIXTURE, PUBLIC_SCROLL_FALLBACK);
}

async function openCleanRichDocument(page, path, content) {
  const verificationWindow = 200;
  await evaluateStep(page, "openCleanRichDocument", async ({ nextPath, nextContent }) => {
    const app = window.__app;
    if (!app?.openFileWithContent) {
      throw new Error("window.__app.openFileWithContent is unavailable.");
    }
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale close failures between perf reps.
      }
    }
    app.setMode("rich");
    await app.openFileWithContent(nextPath, nextContent);
  }, { nextPath: path, nextContent: content });
  await page.waitForFunction(
    ({ expectedLength, expectedPrefix, expectedSuffix }) => {
      const docText = window.__cmView?.state?.doc?.toString();
      return typeof docText === "string" &&
        docText.length === expectedLength &&
        docText.startsWith(expectedPrefix) &&
        docText.endsWith(expectedSuffix);
    },
    {
      expectedLength: content.length,
      expectedPrefix: content.slice(0, verificationWindow),
      expectedSuffix: content.slice(-verificationWindow),
    },
    { timeout: 10000 },
  );
  await sleep(200);
  return content;
}

async function measureTypingBurst(page, anchor, insertCount) {
  return evaluateStep(page, "measureTypingBurst", async ({ nextAnchor, count }) => {
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

    const view = window.__cmView;
    view.dispatch({ selection: { anchor: nextAnchor }, scrollIntoView: true });
    view.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const timings = [];
    const wallStart = performance.now();
    for (let i = 0; i < count; i += 1) {
      const pos = view.state.selection.main.anchor;
      const t0 = performance.now();
      view.dispatch({
        changes: { from: pos, to: pos, insert: "1" },
        selection: { anchor: pos + 1 },
      });
      timings.push(performance.now() - t0);
    }
    const wallMs = performance.now() - wallStart;
    const settleStart = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settleMs = performance.now() - settleStart;

    return {
      wallMs,
      meanDispatchMs: mean(timings),
      maxDispatchMs: Math.max(...timings, 0),
      settleMs,
    };
  }, { nextAnchor: anchor, count: insertCount });
}

export function typingBurstMetrics(caseKey, positionKey, result) {
  const withContext = (name) => `${name}.${caseKey}.${positionKey}`;
  return [
    { name: withContext("typing.wall_ms"), unit: "ms", value: result.wallMs },
    {
      name: withContext("typing.dispatch_mean_ms"),
      unit: "ms",
      value: result.meanDispatchMs,
    },
    {
      name: withContext("typing.dispatch_max_ms"),
      unit: "ms",
      value: result.maxDispatchMs,
    },
    { name: withContext("typing.settle_ms"), unit: "ms", value: result.settleMs },
  ];
}

function typingBurstRequiredMetricNames(caseDefinitions = TYPING_BURST_CASES) {
  const metricNames = [];
  for (const caseDef of caseDefinitions) {
    for (const positionKey of caseDef.positionKeys ?? DEFAULT_TYPING_BURST_POSITION_KEYS) {
      for (const metricName of TYPING_BURST_REQUIRED_METRICS) {
        metricNames.push(`${metricName}.${caseDef.key}.${positionKey}`);
      }
    }
  }
  return metricNames;
}

export const scenarios = {
  "open-index": {
    description: "Reload the app and open demo/index.md in Rich mode.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, "index.md", { mode: "rich" });
    },
  },
  "open-heavy-post": {
    description: "Reload the app and open a heavy math/reference fixture post.",
    defaultSettleMs: 700,
    run: async (page) => {
      await openFixtureDocument(page, "posts/2020-07-11-yotta-savings-and-covering-designs.md", { mode: "rich" });
    },
  },
  "mode-cycle-index": {
    description: "Reload the app, open demo/index.md, then cycle Source/Read/Rich.",
    defaultSettleMs: 500,
    run: async (page) => {
      await openFixtureDocument(page, "index.md", { mode: "rich" });
      await switchToMode(page, "source");
      await switchToMode(page, "read");
      await switchToMode(page, "rich");
    },
  },
  "local-edit-index": {
    description: "Reload the app, open demo/index.md, then apply a local inline-math edit.",
    defaultSettleMs: 300,
    run: async (page) => {
      await openFixtureDocument(page, "index.md", { mode: "rich" });
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
  "typing-rich-burst": {
    description: "Measure rich-mode typing bursts across prose, inline math, and citation/ref hotspots, including the canonical heavy fixture.",
    defaultSettleMs: 200,
    requiredMetrics: typingBurstRequiredMetricNames(availableTypingBurstCases()),
    run: async (page) => {
      const metrics = [];
      for (const testCase of availableTypingBurstCases().map(resolveTypingBurstFixture)) {
        const originalText = await openCleanRichDocument(
          page,
          testCase.virtualPath,
          testCase.content,
        );
        const positions = findTypingBurstPositions(
          originalText,
          testCase.positionKeys,
        );
        for (const [positionKey, position] of Object.entries(positions)) {
          await openCleanRichDocument(page, testCase.virtualPath, testCase.content);
          const result = await measureTypingBurst(page, position.anchor, TYPING_BURST_INSERT_COUNT);
          metrics.push(...typingBurstMetrics(testCase.key, positionKey, result));
        }
      }
      return { metrics };
    },
  },
  "scroll-step-rich": {
    description: `Open the preferred heavy Rich-mode scroll fixture, falling back to demo/index.md when local private fixtures are unavailable.`,
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "rich" });
      await sleep(800);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
    },
  },
  "scroll-jump-rich": {
    description: "Open the preferred heavy Rich-mode scroll fixture, then perform cold and warm jump scrolls.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "rich" });
      await sleep(800);

      const jumpResult = await page.evaluate(async () => {
        const view = window.__cmView;
        const totalLines = view.state.doc.lines;
        const nearBottom = Math.max(1, totalLines - 10);

        // Cold jump: top to near-bottom
        const lb = view.state.doc.line(nearBottom);
        const t0 = performance.now();
        view.dispatch({ selection: { anchor: lb.from }, scrollIntoView: true });
        const coldMs = performance.now() - t0;

        await new Promise((r) => setTimeout(r, 200));

        // Warm jump: back to top
        const lt = view.state.doc.line(1);
        const t1 = performance.now();
        view.dispatch({ selection: { anchor: lt.from }, scrollIntoView: true });
        const warmBackMs = performance.now() - t1;

        await new Promise((r) => setTimeout(r, 200));

        // Warm jump: forward again
        const lb2 = view.state.doc.line(nearBottom);
        const t2 = performance.now();
        view.dispatch({ selection: { anchor: lb2.from }, scrollIntoView: true });
        const warmForwardMs = performance.now() - t2;

        return { coldMs, warmBackMs, warmForwardMs };
      });

      return {
        metrics: [
          { name: "scroll.cold_jump_ms", unit: "ms", value: jumpResult.coldMs },
          { name: "scroll.warm_back_ms", unit: "ms", value: jumpResult.warmBackMs },
          { name: "scroll.warm_forward_ms", unit: "ms", value: jumpResult.warmForwardMs },
        ],
      };
    },
  },
  "scroll-step-source": {
    description: "Open the preferred heavy Source-mode scroll fixture, falling back to demo/index.md when local private fixtures are unavailable.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "source" });
      await sleep(800);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
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
  --browser <managed|cdp>  Browser lane (default: managed)
  --headed                 Show the Playwright-owned browser window
  --port <n>               CDP port for Chrome for Testing (default: 9322)
  --url <url>              App URL that Chrome is already running against
`);
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const hasExplicitCommand = argv[0] === "capture" || argv[0] === "compare";
  const command = hasExplicitCommand ? argv[0] : "capture";
  const options = hasExplicitCommand ? argv.slice(1) : argv;

  return {
    command,
    options,
    chromeArgs: parseChromeArgs(options, { browser: "managed" }),
    ...createArgParser(options),
  };
}

async function runScenarioSamples(page, scenarioName, iterations, warmup, settleMs, appUrl) {
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioName}".`);
  }

  const snapshots = [];
  const totalRuns = warmup + iterations;

  for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
    await discardDirtyPerfState(page);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await waitForDebugBridge(page);
    await clearPerf(page);
    const scenarioResult = await scenario.run(page);
    await sleep(settleMs);
    await assertEditorHealth(page, `${scenarioName} run ${runIndex + 1}`);
    const snapshot = await getPerfSnapshot(page);
    if (runIndex >= warmup) {
      snapshots.push({
        ...snapshot,
        metrics: scenarioResult?.metrics ?? [],
      });
    }
    await discardDirtyPerfState(page);
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

export async function main(argv = process.argv.slice(2)) {
  const { command, options, chromeArgs, getFlag, getIntFlag } = parseCliArgs(argv);
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

  const page = await connectEditor({
    browser: chromeArgs.browser,
    headless: chromeArgs.headless,
    port: chromeArgs.port,
    url: chromeArgs.url,
  });
  try {
    const appUrl = getFlag("--url") ?? page.url();
    const snapshots = await runScenarioSamples(page, scenarioName, iterations, warmup, settleMs, appUrl);
    const report = buildPerfRegressionReport({
      scenario: scenarioName,
      iterations,
      warmup,
      settleMs,
      requiredMetrics: scenario.requiredMetrics ?? [],
      chromePort: chromeArgs.port,
      appUrl,
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
    await discardDirtyPerfState(page);
    await disconnectBrowser(page);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
