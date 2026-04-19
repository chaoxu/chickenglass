#!/usr/bin/env node

/* global window */

import console from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  PERF_REPORT_VERSION,
  buildPerfRegressionReport,
  comparePerfRegressionReports,
} from "./perf-regression-lib.mjs";
import {
  assertEditorHealth,
  createArgParser,
  disconnectBrowser,
  formatRuntimeIssues,
  hasFixtureDocument,
  openBrowserHarness,
  openFixtureDocument,
  resolveFixtureDocumentWithFallback,
  sleep,
  switchToMode,
  waitForDebugBridge,
  withRuntimeIssueCapture,
} from "./test-helpers.mjs";
import { DEBUG_EDITOR_SELECTOR } from "./test-helpers/shared.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";
import { startOrReuseDevServer } from "./dev-server.mjs";
import {
  TOOLING_FIXTURES,
  fixtureCoverageWarning,
  fixtureForHarness,
} from "./tooling-fixtures.mjs";

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
        // Ignore cleanup failures between perf reps.
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Execution context was destroyed")) {
      throw error;
    }
  }
}

const SCROLL_FIXTURE = fixtureForHarness("rankdecrease");
const PUBLIC_SCROLL_FALLBACK = fixtureForHarness("publicShowcase");

export const TYPING_BURST_REQUIRED_METRICS = [
  "typing.wall_ms",
  "typing.dispatch_mean_ms",
  "typing.dispatch_max_ms",
  "typing.settle_ms",
];

const DEFAULT_TYPING_BURST_POSITION_KEYS = ["after_frontmatter", "near_end"];

async function runSteppedScroll(page) {
  return page.evaluate(async (editorSelector) => {
    const editor = document.querySelector(editorSelector);
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Missing lexical editor element.");
    }

    const maxScrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight);
    const stepSize = Math.max(120, Math.floor(editor.clientHeight / 3));
    const steps = [];

    for (let scrollTop = stepSize; scrollTop <= maxScrollTop; scrollTop += stepSize) {
      const target = Math.min(scrollTop, maxScrollTop);
      const t0 = performance.now();
      editor.scrollTop = target;
      editor.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      steps.push(performance.now() - t0);
    }

    const total = steps.reduce((a, b) => a + b, 0);
    return {
      stepCount: steps.length,
      meanStepMs: total / (steps.length || 1),
      maxStepMs: Math.max(...steps, 0),
      totalMs: total,
    };
  }, DEBUG_EDITOR_SELECTOR);
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
    ...fixtureForHarness("publicShowcase"),
    catalogKey: "publicShowcase",
    key: "index",
    positionKeys: DEFAULT_TYPING_BURST_POSITION_KEYS,
  },
  {
    ...fixtureForHarness("rankdecrease"),
    catalogKey: "rankdecrease",
    key: "rankdecrease",
    positionKeys: DEFAULT_TYPING_BURST_POSITION_KEYS,
  },
  {
    ...fixtureForHarness("cogirthMain2"),
    catalogKey: "cogirthMain2",
    key: "cogirth_main2",
    positionKeys: [
      ...DEFAULT_TYPING_BURST_POSITION_KEYS,
      "inline_math",
      "citation_ref",
    ],
  },
];
const TYPING_BURST_INSERT_COUNT = 100;

export function availableTypingBurstCases(caseDefinitions = TYPING_BURST_CASES) {
  return caseDefinitions.filter((caseDef) => hasFixtureDocument(caseDef));
}

export function unavailableTypingBurstCases(caseDefinitions = TYPING_BURST_CASES) {
  return caseDefinitions.filter((caseDef) => !hasFixtureDocument(caseDef));
}

function formatFixtureCandidates(fixture) {
  return (fixture.candidates ?? []).join(", ") || "<default fixture search paths>";
}

function formatMissingTypingBurstFixtures(missingCases) {
  return [
    "Missing required typing benchmark fixture(s); perf coverage would be incomplete.",
    ...missingCases.map((caseDef) => {
      const purpose = TOOLING_FIXTURES[caseDef.catalogKey]?.purpose ?? "typing benchmark fixture";
      return `- ${caseDef.displayPath}: ${purpose}; tried ${formatFixtureCandidates(caseDef)}`;
    }),
  ].join("\n");
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

function scrollFixtureCoverageWarnings() {
  if (hasFixtureDocument(SCROLL_FIXTURE)) {
    return [];
  }
  return [
    `${fixtureCoverageWarning("rankdecrease", "publicShowcase")} Perf coverage is public fallback only.`,
  ];
}

function perfFixtureCoverageWarnings(scenarioName) {
  if (
    scenarioName === "open-scroll-fixture" ||
    scenarioName === "scroll-step-lexical" ||
    scenarioName === "scroll-step-source"
  ) {
    return scrollFixtureCoverageWarnings();
  }
  return [];
}

function validatePerfFixtureCoverage(scenarioName) {
  if (scenarioName === "typing-lexical-burst") {
    const missingCases = unavailableTypingBurstCases();
    if (missingCases.length > 0) {
      throw new Error(formatMissingTypingBurstFixtures(missingCases));
    }
  }
  return perfFixtureCoverageWarnings(scenarioName);
}

async function waitForScrollableEditor(page) {
  await page.waitForFunction(
    (editorSelector) => {
      const editor = document.querySelector(editorSelector);
      return editor instanceof HTMLElement && editor.scrollHeight > editor.clientHeight;
    },
    DEBUG_EDITOR_SELECTOR,
    { timeout: 10000 },
  );
}

async function openCleanLexicalDocument(page, path, content) {
  const verificationWindow = 200;
  await evaluateStep(page, "openCleanLexicalDocument", async ({ nextPath, nextContent }) => {
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
    app.setMode("lexical");
    await app.openFileWithContent(nextPath, nextContent);
  }, { nextPath: path, nextContent: content });
  await page.waitForFunction(
    ({ expectedLength, expectedPrefix, expectedSuffix }) => {
      const docText = window.__editor?.getDoc?.();
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
  return content;
}

async function measureTypingBurst(page, anchor, insertCount) {
  return evaluateStep(page, "measureTypingBurst", async ({ nextAnchor, count }) => {
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

    window.__editor.setSelection(nextAnchor);
    window.__editor.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const timings = [];
    const wallStart = performance.now();
    for (let i = 0; i < count; i += 1) {
      const t0 = performance.now();
      window.__editor.insertText("1");
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
    description: "Reload the app and open demo/index.md in Lexical mode.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, "index.md", { mode: "lexical", project: "full-project" });
    },
  },
  "open-scroll-fixture": {
    description: "Reload the app and open the preferred heavy markdown fixture in Lexical mode.",
    defaultSettleMs: 700,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "lexical", project: "full-project" });
    },
  },
  "mode-cycle-index": {
    description: "Reload the app, open demo/index.md, then cycle Source/Lexical.",
    defaultSettleMs: 500,
    run: async (page) => {
      await openFixtureDocument(page, "index.md", { mode: "lexical", project: "full-project" });
      await switchToMode(page, "source");
      await switchToMode(page, "lexical");
    },
  },
  "typing-lexical-burst": {
    description: "Measure Lexical-mode typing bursts across prose, inline math, and citation/ref hotspots.",
    defaultSettleMs: 200,
    requiredMetrics: typingBurstRequiredMetricNames(),
    run: async (page) => {
      const metrics = [];
      for (const testCase of TYPING_BURST_CASES.map(resolveTypingBurstFixture)) {
        const originalText = await openCleanLexicalDocument(
          page,
          testCase.virtualPath,
          testCase.content,
        );
        const positions = findTypingBurstPositions(
          originalText,
          testCase.positionKeys,
        );
        for (const [positionKey, position] of Object.entries(positions)) {
          await openCleanLexicalDocument(page, testCase.virtualPath, testCase.content);
          const result = await measureTypingBurst(page, position.anchor, TYPING_BURST_INSERT_COUNT);
          metrics.push(...typingBurstMetrics(testCase.key, positionKey, result));
        }
      }
      return { metrics };
    },
  },
  "scroll-step-lexical": {
    description: "Open the preferred heavy Lexical-mode scroll fixture, falling back to demo/index.md when private fixtures are unavailable.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "lexical", project: "full-project" });
      await waitForScrollableEditor(page);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
    },
  },
  "scroll-step-source": {
    description: "Open the preferred heavy Source-mode scroll fixture, falling back to demo/index.md when private fixtures are unavailable.",
    defaultSettleMs: 400,
    run: async (page) => {
      await openFixtureDocument(page, resolveScrollFixture(), { mode: "source", project: "full-project" });
      await waitForScrollableEditor(page);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
    },
  },
};

function printUsage() {
  console.log(`Usage:
  node scripts/perf-regression.mjs capture [options]
  node scripts/perf-regression.mjs compare --baseline <path> [options]

Commands:
  capture                  Run the scenario and write a perf report (default)
  compare                  Run the scenario and diff against a baseline report

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
  --no-server              Do not start/reuse Vite; connect to --url/default URL directly
  --heavy-doc              Use long timeouts/settles for heavy-doc automation
  -h, --help               Show this help text

Fixtures:
  Preferred heavy fixture: ${TOOLING_FIXTURES.rankdecrease.displayPath}
  Fallback public fixture: ${TOOLING_FIXTURES.publicShowcase.displayPath}

Examples:
  # Standard baseline/check workflow, including dev-server management
  pnpm perf:baseline
  pnpm perf:check

  # Capture a baseline using the heavy fixture
  pnpm perf:capture:heavy -- --scenario scroll-step-lexical --output /tmp/baseline.json

  # Compare a fresh run against that baseline
  pnpm perf:compare:heavy -- --scenario scroll-step-lexical --baseline /tmp/baseline.json
`);
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const hasExplicitCommand = argv[0] === "capture" || argv[0] === "compare";
  const command = hasExplicitCommand ? argv[0] : "capture";
  const options = hasExplicitCommand ? argv.slice(1) : argv;

  const parser = createArgParser(options);
  const heavyDoc = parser.hasFlag("--heavy-doc");

  return {
    command,
    options,
    heavyDoc,
    chromeArgs: parseChromeArgs(options, { browser: "managed" }),
    ...parser,
  };
}

export function resolvePerfServerPlan({ chromeUrl, explicitUrl, noServer }) {
  if (noServer) {
    return {
      ownServer: false,
      url: explicitUrl ?? chromeUrl,
    };
  }
  return {
    ownServer: true,
    url: explicitUrl,
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
    const { value, issues } = await withRuntimeIssueCapture(
      page,
      async () => {
        await discardDirtyPerfState(page);
        await page.goto(appUrl, { waitUntil: "domcontentloaded" });
        await waitForDebugBridge(page);
        await clearPerf(page);
        const scenarioResult = await scenario.run(page);
        await sleep(settleMs);
        await assertEditorHealth(page, `${scenarioName} run ${runIndex + 1}`);
        const snapshot = await getPerfSnapshot(page);
        return { scenarioResult, snapshot };
      },
      scenario.runtimeIssueOptions ?? {},
    );
    if (issues.length > 0) {
      throw new Error(`${scenarioName} run ${runIndex + 1}: runtime issues: ${formatRuntimeIssues(issues)}`);
    }
    if (runIndex >= warmup) {
      snapshots.push({
        ...value.snapshot,
        metrics: value.scenarioResult?.metrics ?? [],
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
  if ((report.fixtureWarnings ?? []).length > 0) {
    console.log("\nFixture coverage warnings");
    for (const warning of report.fixtureWarnings) {
      console.log(`- ${warning}`);
    }
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
  const { command, options, heavyDoc, chromeArgs, getFlag, getIntFlag, hasFlag } = parseCliArgs(argv);
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
  const defaultSettleMs = heavyDoc ? Math.max(scenario.defaultSettleMs, 3000) : scenario.defaultSettleMs;
  const settleMs = getIntFlag("--settle-ms", defaultSettleMs);
  const fixtureWarnings = validatePerfFixtureCoverage(scenarioName);
  for (const warning of fixtureWarnings) {
    console.warn(`Perf fixture coverage: ${warning}`);
  }

  const serverPlan = resolvePerfServerPlan({
    chromeUrl: chromeArgs.url,
    explicitUrl: getFlag("--url"),
    noServer: hasFlag("--no-server"),
  });
  const server = serverPlan.ownServer
    ? await startOrReuseDevServer({ url: serverPlan.url })
    : { url: serverPlan.url, stop: async () => {} };
  let page = null;
  try {
    page = await openBrowserHarness({
      browser: chromeArgs.browser,
      headless: chromeArgs.headless,
      port: chromeArgs.port,
      url: server.url,
    });
    const appUrl = server.url;
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
    report.fixtureWarnings = fixtureWarnings;

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
    if (page) {
      await discardDirtyPerfState(page);
      await disconnectBrowser(page);
    }
    await server.stop();
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
