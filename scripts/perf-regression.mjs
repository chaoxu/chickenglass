#!/usr/bin/env node

/* global window */

import console from "node:console";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertEditorHealth } from "./browser-health.mjs";
import {
  sleep,
  waitForDebugBridge,
} from "./browser-lifecycle.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";
import { createArgParser, splitCliCommand } from "./devx-cli.mjs";
import {
  closeBrowserSession,
  openBrowserSession,
} from "./devx-browser-session.mjs";
import {
  buildPerfRegressionReport,
  comparePerfRegressionReports,
  PERF_REPORT_VERSION,
} from "./perf-regression-lib.mjs";
import {
  EXTERNAL_DEMO_ROOT,
  EXTERNAL_FIXTURE_ROOT,
  hasFixtureDocument,
  openFixtureDocument,
  PUBLIC_SHOWCASE_FIXTURE,
  resolveFixtureDocument,
  resolveFixtureDocumentWithFallback,
  switchToMode,
} from "./editor-test-helpers.mjs";

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

async function getFrontendPerfSummaries(page) {
  const snapshot = await getPerfSnapshot(page);
  return snapshot.frontend?.summaries ?? [];
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
const DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS = 15000;
const DEFAULT_FIXTURE_OPEN_TIMEOUT_MS = 10000;
const DEFAULT_POST_OPEN_SETTLE_MS = 200;
const HEAVY_DOC_DEBUG_BRIDGE_TIMEOUT_MS = 45000;
const HEAVY_DOC_FIXTURE_OPEN_TIMEOUT_MS = 45000;
const HEAVY_DOC_POST_OPEN_SETTLE_MS = 800;
const LATEX_PANDOC_FROM = "markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark";
const PANDOC_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const HTML_EXPORT_SUPPORT_EXTENSIONS = new Set([
  ".bib",
  ".csl",
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".json",
  ".png",
  ".svg",
  ".txt",
  ".webp",
  ".yaml",
  ".yml",
]);
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
  "typing.idle_ms",
  "typing.input_to_idle_ms",
];

export const LEXICAL_TYPING_BURST_REQUIRED_METRICS = [
  "lexical.typing.wall_ms",
  "lexical.typing.insert_mean_ms",
  "lexical.typing.insert_max_ms",
  "lexical.typing.canonical_ms",
  "lexical.typing.visual_sync_ms",
  "lexical.typing.semantic_ms",
  "lexical.typing.deferred_sync_work_ms",
  "lexical.typing.deferred_sync_count",
  "lexical.typing.incremental_sync_work_ms",
  "lexical.typing.incremental_sync_count",
  "lexical.typing.source_span_index_work_ms",
  "lexical.typing.source_span_index_count",
  "lexical.typing.input_to_semantic_ms",
];

export const HTML_EXPORT_PANDOC_REQUIRED_METRICS = [
  "export.html.wall_ms",
  "export.html.input_bytes",
  "export.html.output_bytes",
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
const POST_TYPING_IDLE_OBSERVATION_MS = 500;

export const HTML_EXPORT_PANDOC_CASES = [
  {
    key: "index",
    displayPath: "demo/index.md",
    virtualPath: "index.md",
    candidates: [
      resolve(REPO_ROOT, "demo/index.md"),
      resolve(EXTERNAL_DEMO_ROOT, "index.md"),
    ],
  },
  {
    key: "cogirth_main2",
    displayPath: "fixtures/cogirth/main2.md",
    virtualPath: "cogirth/main2.md",
    candidates: [
      resolve(REPO_ROOT, "fixtures/cogirth/main2.md"),
      resolve(EXTERNAL_FIXTURE_ROOT, "cogirth/main2.md"),
    ],
  },
];

export function availableTypingBurstCases(caseDefinitions = TYPING_BURST_CASES) {
  return caseDefinitions.filter((caseDef) => hasFixtureDocument(caseDef));
}

export function availableHtmlExportPandocCases(
  caseDefinitions = HTML_EXPORT_PANDOC_CASES,
) {
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

export function frontendSpanDeltaMetrics(
  metricPrefix,
  caseKey,
  positionKey,
  beforeSummaries,
  afterSummaries,
) {
  const beforeByName = new Map(beforeSummaries.map((entry) => [entry.name, entry]));
  return afterSummaries
    .flatMap((after) => {
      const before = beforeByName.get(after.name);
      const countDelta = Math.max(0, (after.count ?? 0) - (before?.count ?? 0));
      const totalDeltaMs = Math.max(0, (after.totalMs ?? 0) - (before?.totalMs ?? 0));
      if (countDelta === 0 && totalDeltaMs === 0) {
        return [];
      }
      return [
        {
          name: `${metricPrefix}.span_total_ms.${after.name}.${caseKey}.${positionKey}`,
          unit: "ms",
          value: totalDeltaMs,
        },
        {
          name: `${metricPrefix}.span_count.${after.name}.${caseKey}.${positionKey}`,
          unit: "count",
          value: countDelta,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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
    resolvedPath,
    content: readFileSync(resolvedPath, "utf8"),
  };
}

function resolveHtmlExportPandocFixture(caseDef) {
  return resolveFixtureDocument(caseDef);
}

function resolveScrollFixture() {
  return resolveFixtureDocumentWithFallback(SCROLL_FIXTURE, PUBLIC_SCROLL_FALLBACK);
}

export function resolvePerfRuntimeOptions({ getIntFlag, hasFlag }) {
  const heavyDoc = hasFlag("--heavy-doc");
  return {
    heavyDoc,
    debugBridgeTimeoutMs: getIntFlag(
      "--debug-timeout-ms",
      heavyDoc ? HEAVY_DOC_DEBUG_BRIDGE_TIMEOUT_MS : DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS,
    ),
    fixtureOpenTimeoutMs: getIntFlag(
      "--open-timeout-ms",
      heavyDoc ? HEAVY_DOC_FIXTURE_OPEN_TIMEOUT_MS : DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
    ),
    postOpenSettleMs: getIntFlag(
      "--post-open-settle-ms",
      heavyDoc ? HEAVY_DOC_POST_OPEN_SETTLE_MS : DEFAULT_POST_OPEN_SETTLE_MS,
    ),
  };
}

async function openCleanRichDocument(page, fixture, runtimeOptions) {
  await openFixtureDocument(
    page,
    fixture,
    {
      mode: "cm6-rich",
      timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
      settleMs: runtimeOptions.postOpenSettleMs,
    },
  );
  return evaluateStep(
    page,
    "getLoadedDocumentText",
    async () => window.__cmView.state.doc.toString(),
  );
}

async function openCleanLexicalDocument(page, fixture, runtimeOptions) {
  await switchToMode(page, "source");
  await openFixtureDocument(
    page,
    fixture,
    {
      mode: "lexical",
      timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
      settleMs: runtimeOptions.postOpenSettleMs,
    },
  );
  return evaluateStep(
    page,
    "getLoadedLexicalDocumentText",
    async () => window.__editor.getDoc(),
  );
}

async function measureTypingBurst(page, anchor, insertCount) {
  return evaluateStep(page, "measureTypingBurst", async ({
    nextAnchor,
    count,
    postIdleObservationMs,
  }) => {
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    const percentile = (values, percentileValue) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    };
    const waitForIdle = () =>
      new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: 1000 });
          return;
        }
        setTimeout(resolve, 0);
      });
    const createLongTaskRecorder = () => {
      const entries = [];
      const supported = Boolean(
        typeof PerformanceObserver === "function"
        && PerformanceObserver.supportedEntryTypes?.includes("longtask"),
      );
      let observer = null;
      if (supported) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            entries.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: false });
      }
      const summarize = (from, to = Number.POSITIVE_INFINITY) => {
        const matched = entries.filter((entry) =>
          entry.startTime >= from && entry.startTime < to
        );
        const durations = matched.map((entry) => entry.duration);
        return {
          count: matched.length,
          totalMs: durations.reduce((sum, value) => sum + value, 0),
          maxMs: Math.max(...durations, 0),
        };
      };
      return {
        supported,
        disconnect() {
          observer?.disconnect();
        },
        summarize,
      };
    };
    const measureEventLoopLag = async (durationMs) => {
      const expectedFrameMs = 1000 / 60;
      const values = [];
      const end = performance.now() + durationMs;
      let last = performance.now();
      while (performance.now() < end) {
        const now = await new Promise((resolve) => {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame((timestamp) => resolve(timestamp));
            return;
          }
          setTimeout(() => resolve(performance.now()), 16);
        });
        values.push(Math.max(0, now - last - expectedFrameMs));
        last = now;
      }
      return {
        samples: values.length,
        meanMs: mean(values),
        p95Ms: percentile(values, 95),
        maxMs: Math.max(...values, 0),
      };
    };

    const view = window.__cmView;
    view.dispatch({ selection: { anchor: nextAnchor }, scrollIntoView: true });
    view.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const longTaskRecorder = createLongTaskRecorder();
    const timings = [];
    const observationStart = performance.now();
    const wallStart = observationStart;
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
    const idleStart = performance.now();
    await waitForIdle();
    const idleMs = performance.now() - idleStart;
    const postIdleStart = performance.now();
    const postIdleLag = await measureEventLoopLag(postIdleObservationMs);
    const postIdleEnd = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const longTasks = longTaskRecorder.summarize(observationStart, postIdleStart);
    const postIdleLongTasks = longTaskRecorder.summarize(postIdleStart, postIdleEnd);
    longTaskRecorder.disconnect();

    return {
      insertCount: count,
      wallMs,
      meanDispatchMs: mean(timings),
      p95DispatchMs: percentile(timings, 95),
      maxDispatchMs: Math.max(...timings, 0),
      settleMs,
      idleMs,
      inputToIdleMs: wallMs + settleMs + idleMs,
      wallPerCharMs: wallMs / count,
      inputToIdlePerCharMs: (wallMs + settleMs + idleMs) / count,
      longTaskSupported: longTaskRecorder.supported ? 1 : 0,
      longTaskCount: longTasks.count,
      longTaskTotalMs: longTasks.totalMs,
      longTaskMaxMs: longTasks.maxMs,
      postIdleWindowMs: postIdleObservationMs,
      postIdleLongTaskCount: postIdleLongTasks.count,
      postIdleLongTaskTotalMs: postIdleLongTasks.totalMs,
      postIdleLongTaskMaxMs: postIdleLongTasks.maxMs,
      postIdleLagSamples: postIdleLag.samples,
      postIdleLagMeanMs: postIdleLag.meanMs,
      postIdleLagP95Ms: postIdleLag.p95Ms,
      postIdleLagMaxMs: postIdleLag.maxMs,
    };
  }, {
    nextAnchor: anchor,
    count: insertCount,
    postIdleObservationMs: POST_TYPING_IDLE_OBSERVATION_MS,
  });
}

async function measureLexicalBridgeTypingBurst(page, anchor, insertCount) {
  return evaluateStep(
    page,
    "measureLexicalBridgeTypingBurst",
    async ({ nextAnchor, count, postIdleObservationMs }) => {
      const mean = (values) =>
        values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
      const percentile = (values, percentileValue) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((left, right) => left - right);
        const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
      };
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForAnimationFrames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const waitForIdle = () =>
        new Promise((resolve) => {
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => resolve(), { timeout: 1000 });
            return;
          }
          setTimeout(resolve, 0);
        });
      const createLongTaskRecorder = () => {
        const entries = [];
        const supported = Boolean(
          typeof PerformanceObserver === "function"
          && PerformanceObserver.supportedEntryTypes?.includes("longtask"),
        );
        let observer = null;
        if (supported) {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              entries.push({ startTime: entry.startTime, duration: entry.duration });
            }
          });
          observer.observe({ type: "longtask", buffered: false });
        }
        const summarize = (from, to = Number.POSITIVE_INFINITY) => {
          const matched = entries.filter((entry) =>
            entry.startTime >= from && entry.startTime < to
          );
          const durations = matched.map((entry) => entry.duration);
          return {
            count: matched.length,
            totalMs: durations.reduce((sum, value) => sum + value, 0),
            maxMs: Math.max(...durations, 0),
          };
        };
        return {
          supported,
          disconnect() {
            observer?.disconnect();
          },
          summarize,
        };
      };
      const measureEventLoopLag = async (durationMs) => {
        const expectedFrameMs = 1000 / 60;
        const values = [];
        const end = performance.now() + durationMs;
        let last = performance.now();
        while (performance.now() < end) {
          const now = await new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame((timestamp) => resolve(timestamp));
              return;
            }
            setTimeout(() => resolve(performance.now()), 16);
          });
          values.push(Math.max(0, now - last - expectedFrameMs));
          last = now;
        }
        return {
          samples: values.length,
          meanMs: mean(values),
          p95Ms: percentile(values, 95),
          maxMs: Math.max(...values, 0),
        };
      };
      const semanticSpanCount = async () => {
        const snapshot = await window.__cfDebug.perfSummary();
        const entry = snapshot.frontend.summaries.find(
          (summary) => summary.name === "lexical.deriveSemanticState",
        );
        return entry?.count ?? 0;
      };
      const frontendSummary = async (name) => {
        const snapshot = await window.__cfDebug.perfSummary();
        return snapshot.frontend.summaries.find((summary) => summary.name === name) ?? null;
      };

      const editor = window.__editor;
      if (!editor) {
        throw new Error("window.__editor is unavailable in Lexical mode.");
      }
      await editor.ready;
      const readCanonicalDoc = () =>
        typeof editor.peekDoc === "function" ? editor.peekDoc() : editor.getDoc();

      const beforeLength = readCanonicalDoc().length;
      const semanticBefore = await frontendSummary("lexical.deriveSemanticState");
      const semanticCountBefore = semanticBefore?.count ?? 0;
      const getMarkdownBefore = await frontendSummary("lexical.getLexicalMarkdown");
      const publishSnapshotBefore = await frontendSummary("lexical.publishRichDocumentSnapshot");
      const deferredSyncBefore = await frontendSummary("lexical.setLexicalMarkdown");
      const incrementalSyncBefore = await frontendSummary("lexical.incrementalRichSync");
      editor.setSelection(nextAnchor);
      editor.focus();
      await waitForAnimationFrames();
      const sourceSpanIndexBefore = await frontendSummary("lexical.createSourceSpanIndex");

      const longTaskRecorder = createLongTaskRecorder();
      const timings = [];
      const beforeDeferredCount = deferredSyncBefore?.count ?? 0;
      const beforeDeferredTotalMs = deferredSyncBefore?.totalMs ?? 0;
      const beforeIncrementalCount = incrementalSyncBefore?.count ?? 0;
      const beforeIncrementalTotalMs = incrementalSyncBefore?.totalMs ?? 0;
      const observationStart = performance.now();
      const wallStart = observationStart;
      for (let i = 0; i < count; i += 1) {
        const t0 = performance.now();
        editor.insertText("1");
        timings.push(performance.now() - t0);
      }
      const wallMs = performance.now() - wallStart;

      const visualSyncStart = performance.now();
      let deferredSyncAfter = await frontendSummary("lexical.setLexicalMarkdown");
      let incrementalSyncAfter = await frontendSummary("lexical.incrementalRichSync");
      while (performance.now() - visualSyncStart < 3000) {
        if (
          (deferredSyncAfter?.count ?? 0) > beforeDeferredCount
          || (incrementalSyncAfter?.count ?? 0) > beforeIncrementalCount
        ) {
          break;
        }
        await sleepInPage(25);
        deferredSyncAfter = await frontendSummary("lexical.setLexicalMarkdown");
        incrementalSyncAfter = await frontendSummary("lexical.incrementalRichSync");
      }
      const visualSyncMs = performance.now() - visualSyncStart;

      const expectedLength = beforeLength + count;
      const canonicalStart = performance.now();
      while (performance.now() - canonicalStart < 5000) {
        if (readCanonicalDoc().length >= expectedLength) {
          break;
        }
        await sleepInPage(0);
      }
      const canonicalMs = performance.now() - canonicalStart;
      const finalLength = readCanonicalDoc().length;
      if (finalLength < expectedLength) {
        throw new Error(
          `Lexical bridge insert did not update canonical markdown: expected length >= ${expectedLength}, got ${finalLength}.`,
        );
      }

      const semanticStart = performance.now();
      while (performance.now() - semanticStart < 3000) {
        if (await semanticSpanCount() > semanticCountBefore) {
          break;
        }
        await sleepInPage(25);
      }
      const semanticMs = performance.now() - semanticStart;

      const settleStart = performance.now();
      await waitForAnimationFrames();
      await waitForIdle();
      const settleMs = performance.now() - settleStart;
      const postIdleStart = performance.now();
      const postIdleLag = await measureEventLoopLag(postIdleObservationMs);
      const postIdleEnd = performance.now();
      await sleepInPage(0);
      const longTasks = longTaskRecorder.summarize(observationStart, postIdleStart);
      const postIdleLongTasks = longTaskRecorder.summarize(postIdleStart, postIdleEnd);
      longTaskRecorder.disconnect();

      const deferredSyncStart = performance.now();
      while (performance.now() - deferredSyncStart < 3000) {
        if (
          (deferredSyncAfter?.count ?? 0) > beforeDeferredCount
          || (incrementalSyncAfter?.count ?? 0) > beforeIncrementalCount
        ) {
          break;
        }
        await sleepInPage(25);
        deferredSyncAfter = await frontendSummary("lexical.setLexicalMarkdown");
        incrementalSyncAfter = await frontendSummary("lexical.incrementalRichSync");
      }
      const deferredSyncCount = Math.max(0, (deferredSyncAfter?.count ?? 0) - beforeDeferredCount);
      const deferredSyncWorkMs = Math.max(
        0,
        (deferredSyncAfter?.totalMs ?? 0) - beforeDeferredTotalMs,
      );
      const incrementalSyncCount = Math.max(
        0,
        (incrementalSyncAfter?.count ?? 0) - beforeIncrementalCount,
      );
      const incrementalSyncWorkMs = Math.max(
        0,
        (incrementalSyncAfter?.totalMs ?? 0) - beforeIncrementalTotalMs,
      );
      const sourceSpanIndexAfter = await frontendSummary("lexical.createSourceSpanIndex");
      const sourceSpanIndexCount = Math.max(
        0,
        (sourceSpanIndexAfter?.count ?? 0) - (sourceSpanIndexBefore?.count ?? 0),
      );
      const sourceSpanIndexWorkMs = Math.max(
        0,
        (sourceSpanIndexAfter?.totalMs ?? 0) - (sourceSpanIndexBefore?.totalMs ?? 0),
      );
      const semanticAfter = await frontendSummary("lexical.deriveSemanticState");
      const getMarkdownAfter = await frontendSummary("lexical.getLexicalMarkdown");
      const publishSnapshotAfter = await frontendSummary("lexical.publishRichDocumentSnapshot");
      const semanticWorkCount = Math.max(
        0,
        (semanticAfter?.count ?? 0) - (semanticBefore?.count ?? 0),
      );
      const semanticWorkMs = Math.max(
        0,
        (semanticAfter?.totalMs ?? 0) - (semanticBefore?.totalMs ?? 0),
      );
      const getMarkdownWorkCount = Math.max(
        0,
        (getMarkdownAfter?.count ?? 0) - (getMarkdownBefore?.count ?? 0),
      );
      const getMarkdownWorkMs = Math.max(
        0,
        (getMarkdownAfter?.totalMs ?? 0) - (getMarkdownBefore?.totalMs ?? 0),
      );
      const publishSnapshotWorkCount = Math.max(
        0,
        (publishSnapshotAfter?.count ?? 0) - (publishSnapshotBefore?.count ?? 0),
      );
      const publishSnapshotWorkMs = Math.max(
        0,
        (publishSnapshotAfter?.totalMs ?? 0) - (publishSnapshotBefore?.totalMs ?? 0),
      );

      return {
        insertCount: count,
        wallMs,
        wallPerCharMs: wallMs / count,
        meanInsertMs: mean(timings),
        p95InsertMs: percentile(timings, 95),
        maxInsertMs: Math.max(...timings, 0),
        canonicalMs,
        visualSyncMs,
        semanticMs,
        semanticWorkCount,
        semanticWorkMs,
        getMarkdownWorkCount,
        getMarkdownWorkMs,
        publishSnapshotWorkCount,
        publishSnapshotWorkMs,
        settleMs,
        deferredSyncCount,
        deferredSyncWorkMs,
        incrementalSyncCount,
        incrementalSyncWorkMs,
        sourceSpanIndexCount,
        sourceSpanIndexWorkMs,
        inputToSemanticMs: wallMs + canonicalMs + semanticMs + settleMs,
        inputToSemanticPerCharMs: (wallMs + canonicalMs + semanticMs + settleMs) / count,
        longTaskSupported: longTaskRecorder.supported ? 1 : 0,
        longTaskCount: longTasks.count,
        longTaskTotalMs: longTasks.totalMs,
        longTaskMaxMs: longTasks.maxMs,
        postIdleWindowMs: postIdleObservationMs,
        postIdleLongTaskCount: postIdleLongTasks.count,
        postIdleLongTaskTotalMs: postIdleLongTasks.totalMs,
        postIdleLongTaskMaxMs: postIdleLongTasks.maxMs,
        postIdleLagSamples: postIdleLag.samples,
        postIdleLagMeanMs: postIdleLag.meanMs,
        postIdleLagP95Ms: postIdleLag.p95Ms,
        postIdleLagMaxMs: postIdleLag.maxMs,
      };
    },
    {
      nextAnchor: anchor,
      count: insertCount,
      postIdleObservationMs: POST_TYPING_IDLE_OBSERVATION_MS,
    },
  );
}

export function typingBurstMetrics(caseKey, positionKey, result) {
  const withContext = (name) => `${name}.${caseKey}.${positionKey}`;
  return [
    { name: withContext("typing.insert_count"), unit: "count", value: result.insertCount },
    { name: withContext("typing.wall_ms"), unit: "ms", value: result.wallMs },
    {
      name: withContext("typing.wall_per_char_ms"),
      unit: "ms",
      value: result.wallPerCharMs,
    },
    {
      name: withContext("typing.dispatch_mean_ms"),
      unit: "ms",
      value: result.meanDispatchMs,
    },
    {
      name: withContext("typing.dispatch_p95_ms"),
      unit: "ms",
      value: result.p95DispatchMs,
    },
    {
      name: withContext("typing.dispatch_max_ms"),
      unit: "ms",
      value: result.maxDispatchMs,
    },
    { name: withContext("typing.settle_ms"), unit: "ms", value: result.settleMs },
    { name: withContext("typing.idle_ms"), unit: "ms", value: result.idleMs },
    {
      name: withContext("typing.input_to_idle_ms"),
      unit: "ms",
      value: result.inputToIdleMs,
    },
    {
      name: withContext("typing.input_to_idle_per_char_ms"),
      unit: "ms",
      value: result.inputToIdlePerCharMs,
    },
    {
      name: withContext("typing.longtask_supported"),
      unit: "count",
      value: result.longTaskSupported,
    },
    { name: withContext("typing.longtask_count"), unit: "count", value: result.longTaskCount },
    {
      name: withContext("typing.longtask_total_ms"),
      unit: "ms",
      value: result.longTaskTotalMs,
    },
    {
      name: withContext("typing.longtask_max_ms"),
      unit: "ms",
      value: result.longTaskMaxMs,
    },
    {
      name: withContext("typing.post_idle_longtask_count"),
      unit: "count",
      value: result.postIdleLongTaskCount,
    },
    {
      name: withContext("typing.post_idle_longtask_total_ms"),
      unit: "ms",
      value: result.postIdleLongTaskTotalMs,
    },
    {
      name: withContext("typing.post_idle_longtask_max_ms"),
      unit: "ms",
      value: result.postIdleLongTaskMaxMs,
    },
    {
      name: withContext("typing.post_idle_lag_samples"),
      unit: "count",
      value: result.postIdleLagSamples,
    },
    {
      name: withContext("typing.post_idle_lag_mean_ms"),
      unit: "ms",
      value: result.postIdleLagMeanMs,
    },
    {
      name: withContext("typing.post_idle_lag_p95_ms"),
      unit: "ms",
      value: result.postIdleLagP95Ms,
    },
    {
      name: withContext("typing.post_idle_lag_max_ms"),
      unit: "ms",
      value: result.postIdleLagMaxMs,
    },
  ];
}

export function lexicalTypingBurstMetrics(caseKey, positionKey, result) {
  const withContext = (name) => `${name}.${caseKey}.${positionKey}`;
  return [
    { name: withContext("lexical.typing.insert_count"), unit: "count", value: result.insertCount },
    { name: withContext("lexical.typing.wall_ms"), unit: "ms", value: result.wallMs },
    {
      name: withContext("lexical.typing.wall_per_char_ms"),
      unit: "ms",
      value: result.wallPerCharMs,
    },
    {
      name: withContext("lexical.typing.insert_mean_ms"),
      unit: "ms",
      value: result.meanInsertMs,
    },
    {
      name: withContext("lexical.typing.insert_p95_ms"),
      unit: "ms",
      value: result.p95InsertMs,
    },
    {
      name: withContext("lexical.typing.insert_max_ms"),
      unit: "ms",
      value: result.maxInsertMs,
    },
    {
      name: withContext("lexical.typing.canonical_ms"),
      unit: "ms",
      value: result.canonicalMs,
    },
    {
      name: withContext("lexical.typing.visual_sync_ms"),
      unit: "ms",
      value: result.visualSyncMs,
    },
    {
      name: withContext("lexical.typing.semantic_ms"),
      unit: "ms",
      value: result.semanticMs,
    },
    {
      name: withContext("lexical.typing.semantic_work_ms"),
      unit: "ms",
      value: result.semanticWorkMs,
    },
    {
      name: withContext("lexical.typing.semantic_work_count"),
      unit: "count",
      value: result.semanticWorkCount,
    },
    {
      name: withContext("lexical.typing.get_markdown_work_ms"),
      unit: "ms",
      value: result.getMarkdownWorkMs,
    },
    {
      name: withContext("lexical.typing.get_markdown_work_count"),
      unit: "count",
      value: result.getMarkdownWorkCount,
    },
    {
      name: withContext("lexical.typing.publish_snapshot_work_ms"),
      unit: "ms",
      value: result.publishSnapshotWorkMs,
    },
    {
      name: withContext("lexical.typing.publish_snapshot_work_count"),
      unit: "count",
      value: result.publishSnapshotWorkCount,
    },
    {
      name: withContext("lexical.typing.deferred_sync_work_ms"),
      unit: "ms",
      value: result.deferredSyncWorkMs,
    },
    {
      name: withContext("lexical.typing.deferred_sync_count"),
      unit: "count",
      value: result.deferredSyncCount,
    },
    {
      name: withContext("lexical.typing.incremental_sync_work_ms"),
      unit: "ms",
      value: result.incrementalSyncWorkMs,
    },
    {
      name: withContext("lexical.typing.incremental_sync_count"),
      unit: "count",
      value: result.incrementalSyncCount,
    },
    {
      name: withContext("lexical.typing.source_span_index_work_ms"),
      unit: "ms",
      value: result.sourceSpanIndexWorkMs,
    },
    {
      name: withContext("lexical.typing.source_span_index_count"),
      unit: "count",
      value: result.sourceSpanIndexCount,
    },
    {
      name: withContext("lexical.typing.input_to_semantic_ms"),
      unit: "ms",
      value: result.inputToSemanticMs,
    },
    {
      name: withContext("lexical.typing.input_to_semantic_per_char_ms"),
      unit: "ms",
      value: result.inputToSemanticPerCharMs,
    },
    {
      name: withContext("lexical.typing.longtask_supported"),
      unit: "count",
      value: result.longTaskSupported,
    },
    {
      name: withContext("lexical.typing.longtask_count"),
      unit: "count",
      value: result.longTaskCount,
    },
    {
      name: withContext("lexical.typing.longtask_total_ms"),
      unit: "ms",
      value: result.longTaskTotalMs,
    },
    {
      name: withContext("lexical.typing.longtask_max_ms"),
      unit: "ms",
      value: result.longTaskMaxMs,
    },
    {
      name: withContext("lexical.typing.post_idle_longtask_count"),
      unit: "count",
      value: result.postIdleLongTaskCount,
    },
    {
      name: withContext("lexical.typing.post_idle_longtask_total_ms"),
      unit: "ms",
      value: result.postIdleLongTaskTotalMs,
    },
    {
      name: withContext("lexical.typing.post_idle_longtask_max_ms"),
      unit: "ms",
      value: result.postIdleLongTaskMaxMs,
    },
    {
      name: withContext("lexical.typing.post_idle_lag_samples"),
      unit: "count",
      value: result.postIdleLagSamples,
    },
    {
      name: withContext("lexical.typing.post_idle_lag_mean_ms"),
      unit: "ms",
      value: result.postIdleLagMeanMs,
    },
    {
      name: withContext("lexical.typing.post_idle_lag_p95_ms"),
      unit: "ms",
      value: result.postIdleLagP95Ms,
    },
    {
      name: withContext("lexical.typing.post_idle_lag_max_ms"),
      unit: "ms",
      value: result.postIdleLagMaxMs,
    },
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

function lexicalTypingBurstRequiredMetricNames(caseDefinitions = TYPING_BURST_CASES) {
  const metricNames = [];
  for (const caseDef of caseDefinitions) {
    for (const positionKey of caseDef.positionKeys ?? DEFAULT_TYPING_BURST_POSITION_KEYS) {
      for (const metricName of LEXICAL_TYPING_BURST_REQUIRED_METRICS) {
        metricNames.push(`${metricName}.${caseDef.key}.${positionKey}`);
      }
    }
  }
  return metricNames;
}

function htmlExportPandocRequiredMetricNames(
  caseDefinitions = HTML_EXPORT_PANDOC_CASES,
) {
  const metricNames = [];
  for (const caseDef of caseDefinitions) {
    for (const metricName of HTML_EXPORT_PANDOC_REQUIRED_METRICS) {
      metricNames.push(`${metricName}.${caseDef.key}`);
    }
  }
  return metricNames;
}

function inferProjectRootFromVirtualPath(resolvedPath, virtualPath) {
  const parts = virtualPath.split("/").filter(Boolean);
  let projectRoot = dirname(resolvedPath);
  for (let index = 1; index < parts.length; index += 1) {
    projectRoot = dirname(projectRoot);
  }
  return projectRoot;
}

function copySupportTree(sourceDir, targetDir, fixturePath) {
  if (!existsSync(sourceDir)) {
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    if (entry.isDirectory()) {
      copySupportTree(sourcePath, targetPath, fixturePath);
      continue;
    }

    if (
      entry.isFile()
      && (
        sourcePath === fixturePath
        || HTML_EXPORT_SUPPORT_EXTENSIONS.has(extname(entry.name).toLowerCase())
      )
    ) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function copySupportFiles(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (
      entry.isFile()
      && HTML_EXPORT_SUPPORT_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      copyFileSync(resolve(sourceDir, entry.name), resolve(targetDir, entry.name));
    }
  }
}

function prepareHtmlExportPandocFixture(caseDef) {
  const fixture = resolveHtmlExportPandocFixture(caseDef);
  const sourceProjectRoot = inferProjectRootFromVirtualPath(
    fixture.resolvedPath,
    fixture.virtualPath,
  );
  const sourceDir = dirname(fixture.resolvedPath);
  const tempProjectRoot = mkdtempSync(join(tmpdir(), "coflat-html-export-perf-"));
  const tempSourcePath = resolve(tempProjectRoot, fixture.virtualPath);
  const tempSourceDir = dirname(tempSourcePath);
  const outputPath = resolve(tempProjectRoot, "exports", `${fixture.key}.html`);

  mkdirSync(tempSourceDir, { recursive: true });
  copyFileSync(fixture.resolvedPath, tempSourcePath);
  copySupportTree(sourceDir, tempSourceDir, fixture.resolvedPath);
  if (sourceDir !== sourceProjectRoot) {
    copySupportFiles(sourceProjectRoot, tempProjectRoot);
  }
  mkdirSync(dirname(outputPath), { recursive: true });

  return {
    ...fixture,
    tempProjectRoot,
    tempSourcePath,
    tempSourceDir,
    outputPath,
    content: readFileSync(tempSourcePath, "utf8"),
    inputBytes: statSync(tempSourcePath).size,
  };
}

function buildPandocResourcePath(projectRoot, sourceDir) {
  const paths = [sourceDir];
  if (sourceDir !== projectRoot) {
    paths.push(projectRoot);
  }
  return paths.join(delimiter);
}

export function buildHtmlExportPandocArgs(projectRoot, sourceDir, outputPath) {
  const resourcePath = buildPandocResourcePath(projectRoot, sourceDir);
  return [
    `--from=${LATEX_PANDOC_FROM}`,
    "--to=html5",
    "--standalone",
    "--wrap=preserve",
    "--katex",
    "--section-divs",
    "--filter=pandoc-crossref",
    "--citeproc",
    "--metadata=link-citations=true",
    `--resource-path=${resourcePath}`,
    `--output=${outputPath}`,
  ];
}

function assertCommandAvailable(command, args, installHint, commandRunner) {
  const result = commandRunner(command, args, {
    encoding: "utf8",
    maxBuffer: PANDOC_MAX_BUFFER_BYTES,
  });
  if (result.error) {
    throw new Error(
      `Missing required command "${command}" for html-export-pandoc. ${installHint}`,
    );
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    throw new Error(
      `Preflight command "${command} ${args.join(" ")}" failed for html-export-pandoc.${
        stderr ? ` ${stderr}` : ""
      }`,
    );
  }
}

export function preflightHtmlExportPandoc({
  commandRunner = spawnSync,
} = {}) {
  assertCommandAvailable(
    "pandoc",
    ["--version"],
    "Install Pandoc or add it to PATH.",
    commandRunner,
  );
  assertCommandAvailable(
    "pandoc-crossref",
    ["--version"],
    "Install pandoc-crossref or add it to PATH. The scenario passes --filter=pandoc-crossref to match Tauri HTML export.",
    commandRunner,
  );
}

function runPandocHtmlExport(caseDef) {
  const fixture = prepareHtmlExportPandocFixture(caseDef);
  try {
    const args = buildHtmlExportPandocArgs(
      fixture.tempProjectRoot,
      fixture.tempSourceDir,
      fixture.outputPath,
    );
    const start = process.hrtime.bigint();
    const result = spawnSync("pandoc", args, {
      cwd: fixture.tempSourceDir,
      encoding: "utf8",
      input: fixture.content,
      maxBuffer: PANDOC_MAX_BUFFER_BYTES,
    });
    const wallMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    if (result.error) {
      throw new Error(
        `Failed to start Pandoc HTML export for ${fixture.displayPath}: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      const stderr = String(result.stderr ?? "").trim();
      throw new Error(
        `Pandoc HTML export failed for ${fixture.displayPath}: ${stderr || `exit ${result.status}`}`,
      );
    }

    return {
      key: fixture.key,
      wallMs,
      inputBytes: fixture.inputBytes,
      outputBytes: statSync(fixture.outputPath).size,
    };
  } finally {
    rmSync(fixture.tempProjectRoot, { recursive: true, force: true });
  }
}

export function htmlExportPandocMetrics(caseKey, result) {
  const withContext = (name) => `${name}.${caseKey}`;
  return [
    { name: withContext("export.html.wall_ms"), unit: "ms", value: result.wallMs },
    {
      name: withContext("export.html.input_bytes"),
      unit: "bytes",
      value: result.inputBytes,
    },
    {
      name: withContext("export.html.output_bytes"),
      unit: "bytes",
      value: result.outputBytes,
    },
  ];
}

export const scenarios = {
  "html-export-pandoc": {
    description: "Run the native Pandoc-backed HTML export path against demo/index.md and the preferred heavy fixture when available.",
    runtime: "native",
    defaultSettleMs: 0,
    requiredMetrics: htmlExportPandocRequiredMetricNames(
      availableHtmlExportPandocCases(),
    ),
    preflight: preflightHtmlExportPandoc,
    run: async () => {
      const metrics = [];
      for (const testCase of availableHtmlExportPandocCases()) {
        const result = runPandocHtmlExport(testCase);
        metrics.push(...htmlExportPandocMetrics(testCase.key, result));
      }
      return { metrics };
    },
  },
  "open-index": {
    description: "Reload the app and open demo/index.md in Rich mode.",
    defaultSettleMs: 400,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, "index.md", {
        mode: "cm6-rich",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
    },
  },
  "open-heavy-post": {
    description: "Reload the app and open a heavy math/reference fixture post.",
    defaultSettleMs: 700,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(
        page,
        "posts/2020-07-11-yotta-savings-and-covering-designs.md",
        {
          mode: "cm6-rich",
          timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
          settleMs: runtimeOptions.postOpenSettleMs,
        },
      );
    },
  },
  "open-cogirth-main2": {
    description: "Reload the app and open fixtures/cogirth/main2.md in Rich mode, falling back to demo/index.md when the private fixture is unavailable.",
    defaultSettleMs: 700,
    run: async (page, runtimeOptions) => {
      const fixture = resolveFixtureDocumentWithFallback(
        SCROLL_FIXTURE,
        PUBLIC_SCROLL_FALLBACK,
      );
      await openFixtureDocument(page, fixture, {
        mode: "cm6-rich",
        project: "full-project",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
    },
  },
  "mode-cycle-index": {
    description: "Reload the app, open demo/index.md, then cycle Source/Lexical/CM6 Rich.",
    defaultSettleMs: 500,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, "index.md", {
        mode: "cm6-rich",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
      await switchToMode(page, "source");
      await switchToMode(page, "lexical");
      await switchToMode(page, "cm6-rich");
    },
  },
  "local-edit-index": {
    description: "Reload the app, open demo/index.md, then apply a local inline-math edit.",
    defaultSettleMs: 300,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, "index.md", {
        mode: "cm6-rich",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
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
    run: async (page, runtimeOptions) => {
      const metrics = [];
      for (const testCase of availableTypingBurstCases().map(resolveTypingBurstFixture)) {
        const originalText = await openCleanRichDocument(
          page,
          testCase,
          runtimeOptions,
        );
        const positions = findTypingBurstPositions(
          originalText,
          testCase.positionKeys,
        );
        for (const [positionKey, position] of Object.entries(positions)) {
          await openCleanRichDocument(
            page,
            testCase,
            runtimeOptions,
          );
          const beforeSummaries = await getFrontendPerfSummaries(page);
          const result = await measureTypingBurst(page, position.anchor, TYPING_BURST_INSERT_COUNT);
          const afterSummaries = await getFrontendPerfSummaries(page);
          metrics.push(
            ...typingBurstMetrics(testCase.key, positionKey, result),
            ...frontendSpanDeltaMetrics(
              "typing",
              testCase.key,
              positionKey,
              beforeSummaries,
              afterSummaries,
            ),
          );
        }
      }
      return { metrics };
    },
  },
  "typing-lexical-bridge-burst": {
    description: "Measure Lexical-mode typing bursts through the product-neutral editor bridge across representative markdown hotspots.",
    defaultSettleMs: 300,
    requiredMetrics: lexicalTypingBurstRequiredMetricNames(availableTypingBurstCases()),
    run: async (page, runtimeOptions) => {
      const metrics = [];
      for (const testCase of availableTypingBurstCases().map(resolveTypingBurstFixture)) {
        const originalText = await openCleanLexicalDocument(
          page,
          testCase,
          runtimeOptions,
        );
        const positions = findTypingBurstPositions(
          originalText,
          testCase.positionKeys,
        );
        for (const [positionKey, position] of Object.entries(positions)) {
          await openCleanLexicalDocument(
            page,
            testCase,
            runtimeOptions,
          );
          const beforeSummaries = await getFrontendPerfSummaries(page);
          const result = await measureLexicalBridgeTypingBurst(
            page,
            position.anchor,
            TYPING_BURST_INSERT_COUNT,
          );
          const afterSummaries = await getFrontendPerfSummaries(page);
          metrics.push(
            ...lexicalTypingBurstMetrics(testCase.key, positionKey, result),
            ...frontendSpanDeltaMetrics(
              "lexical.typing",
              testCase.key,
              positionKey,
              beforeSummaries,
              afterSummaries,
            ),
          );
        }
      }
      return { metrics };
    },
  },
  "scroll-step-rich": {
    description: `Open the preferred heavy Rich-mode scroll fixture, falling back to demo/index.md when local private fixtures are unavailable.`,
    defaultSettleMs: 400,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, resolveScrollFixture(), {
        mode: "cm6-rich",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
      await sleep(800);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
    },
  },
  "scroll-jump-rich": {
    description: "Open the preferred heavy Rich-mode scroll fixture, then perform cold and warm jump scrolls.",
    defaultSettleMs: 400,
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, resolveScrollFixture(), {
        mode: "cm6-rich",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
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
    run: async (page, runtimeOptions) => {
      await openFixtureDocument(page, resolveScrollFixture(), {
        mode: "source",
        timeoutMs: runtimeOptions.fixtureOpenTimeoutMs,
        settleMs: runtimeOptions.postOpenSettleMs,
      });
      await sleep(800);
      const result = await runSteppedScroll(page);
      return { metrics: steppedScrollMetrics(result) };
    },
  },
};

function printUsage() {
  console.log(`Usage:
  pnpm perf:capture -- --scenario open-index --output output/perf/open-index.json
  pnpm perf:compare -- --scenario open-index --baseline output/perf/open-index.json

Options:
  --scenario <name>        One of: ${Object.keys(scenarios).join(", ")}
  --iterations <n>         Measured iterations (default: 3)
  --warmup <n>             Warmup iterations before capture (default: 1)
  --settle-ms <n>          Extra settle time after scenario (default: scenario-specific)
  --output <path>          Where to write the captured report (capture only)
  --baseline <path>        Baseline report to compare against (compare only)
  --threshold-pct <n>      Regression threshold percent (default: 25)
  --min-delta-ms <n>       Minimum absolute delta before flagging (default: 5)
  --heavy-doc              Use long timeouts/settles for heavy-doc automation
  --debug-timeout-ms <n>   Override debug-bridge timeout (default: 15000 / 45000 heavy)
  --open-timeout-ms <n>    Override fixture-open verification timeout (default: 10000 / 45000 heavy)
  --post-open-settle-ms <n> Extra settle after opening fixtures (default: 200 / 800 heavy)
  --browser <managed|cdp>  Browser lane (default: managed)
  --headed                 Show the Playwright-owned browser window
  --port <n>               CDP port for Chrome for Testing (default: 9322)
  --url <url>              App URL that Chrome is already running against
  --no-start-server        Do not auto-start Vite for managed localhost runs

Native scenarios such as html-export-pandoc skip Vite/Playwright and run local tooling directly.
`);
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const { command, options } = splitCliCommand(argv, ["capture", "compare"], "capture");

  return {
    command,
    options,
    chromeArgs: parseChromeArgs(options, { browser: "managed" }),
    ...createArgParser(options),
  };
}

async function runScenarioSamples(
  page,
  scenarioName,
  iterations,
  warmup,
  settleMs,
  appUrl,
  runtimeOptions,
) {
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioName}".`);
  }

  const snapshots = [];
  const totalRuns = warmup + iterations;

  for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
    await discardDirtyPerfState(page);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await waitForDebugBridge(page, { timeout: runtimeOptions.debugBridgeTimeoutMs });
    await clearPerf(page);
    const scenarioResult = await scenario.run(page, runtimeOptions);
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

async function runNativeScenarioSamples(
  scenarioName,
  iterations,
  warmup,
  settleMs,
  runtimeOptions,
) {
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioName}".`);
  }

  scenario.preflight?.(runtimeOptions);

  const snapshots = [];
  const totalRuns = warmup + iterations;
  for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
    const scenarioResult = await scenario.run(null, runtimeOptions);
    await sleep(settleMs);
    if (runIndex >= warmup) {
      snapshots.push({
        frontend: { summaries: [] },
        backend: { summaries: [] },
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

export function printComparison(result) {
  const rows = comparisonFailureRows(result);
  if (rows.length === 0) {
    console.log("No perf regressions detected.");
    return;
  }

  console.log("Perf regressions or missing measurements detected:");
  console.table(rows);
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
  const runtimeOptions = resolvePerfRuntimeOptions({
    getIntFlag,
    hasFlag: (flag) => options.includes(flag),
  });

  let browserSession = null;
  let page;
  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (page) {
      try {
        await discardDirtyPerfState(page);
      } finally {
        await closeBrowserSession(browserSession);
        browserSession = null;
        page = null;
      }
    }
    if (browserSession) {
      await closeBrowserSession(browserSession);
      browserSession = null;
    }
  };
  const onSigint = () => {
    cleanup().finally(() => process.exit(130));
  };
  const onSigterm = () => {
    cleanup().finally(() => process.exit(143));
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    let appUrl = null;
    let snapshots;
    if (scenario.runtime === "native") {
      snapshots = await runNativeScenarioSamples(
        scenarioName,
        iterations,
        warmup,
        settleMs,
        runtimeOptions,
      );
    } else {
      browserSession = await openBrowserSession(options, {
        defaultBrowser: "managed",
        reloadCdp: false,
        timeoutFallback: runtimeOptions.debugBridgeTimeoutMs,
      });
      page = browserSession.page;
      appUrl = getFlag("--url") ?? page.url();
      snapshots = await runScenarioSamples(
        page,
        scenarioName,
        iterations,
        warmup,
        settleMs,
        appUrl,
        runtimeOptions,
      );
    }

    const report = buildPerfRegressionReport({
      scenario: scenarioName,
      iterations,
      warmup,
      settleMs,
      requiredMetrics: scenario.requiredMetrics ?? [],
      chromePort: scenario.runtime === "native" ? null : chromeArgs.port,
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
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
