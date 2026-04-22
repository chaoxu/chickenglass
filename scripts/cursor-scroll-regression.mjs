#!/usr/bin/env node

import console from "node:console";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import {
  assertEditorHealth,
  createArgParser,
  EXTERNAL_FIXTURE_ROOT,
  openFixtureDocument,
  PUBLIC_SHOWCASE_FIXTURE,
  resolveFixtureDocumentWithFallback,
  sleep,
  traceVerticalCursorMotion,
} from "./test-helpers.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export const RANKDECREASE_CURSOR_FIXTURE = {
  displayPath: "fixtures/rankdecrease/main.md",
  virtualPath: "rankdecrease/main.md",
  candidates: [
    resolve(REPO_ROOT, "fixtures/rankdecrease/main.md"),
    resolve(EXTERNAL_FIXTURE_ROOT, "rankdecrease/main.md"),
  ],
};

const PUBLIC_CURSOR_FALLBACK = {
  ...PUBLIC_SHOWCASE_FIXTURE,
  defaultLine: 139,
};

function traceWindow(trace, index, radius = 1) {
  const from = Math.max(0, index - radius);
  const to = Math.min(trace.length, index + radius + 1);
  return trace.slice(from, to);
}

export function findReverseScrollJump(
  trace,
  { direction = "up", minReverseScrollPx = 120 } = {},
) {
  for (let index = 1; index < trace.length; index += 1) {
    const previous = trace[index - 1];
    const current = trace[index];
    const lineDelta = current.line - previous.line;
    const headDelta = current.head - previous.head;
    const scrollDelta = current.scrollTop - previous.scrollTop;
    const cursorTopDelta = previous.cursorTop !== null && current.cursorTop !== null
      ? current.cursorTop - previous.cursorTop
      : null;
    const movedInExpectedDirection = direction === "up"
      ? lineDelta < 0 || headDelta < 0
      : lineDelta > 0 || headDelta > 0;
    const reversedScroll = direction === "up"
      ? scrollDelta >= minReverseScrollPx
      : scrollDelta <= -minReverseScrollPx;

    if (movedInExpectedDirection && reversedScroll) {
      return {
        index,
        previous,
        current,
        lineDelta,
        headDelta,
        scrollDelta,
        cursorTopDelta,
      };
    }
  }

  return null;
}

function formatLineInfo(entry) {
  const classes = entry.info?.classes?.length ? ` classes=${entry.info.classes.join(",")}` : "";
  const hidden = entry.info ? ` hidden=${String(entry.info.hidden)}` : "";
  return `${entry.line.toString().padStart(4, " ")} | ${entry.text}${hidden}${classes}`;
}

export function formatCursorScrollReport({
  fixture,
  traceResult,
  anomaly,
  minReverseScrollPx,
}) {
  const trace = traceResult.trace;
  const start = trace[0] ?? null;
  const end = trace.at(-1) ?? null;
  const header = [
    `Fixture: ${fixture.displayPath} via ${fixture.method}`,
    `Source: ${fixture.resolvedPath ?? "<openFileWithContent>"}`,
    `Direction: ${traceResult.direction}`,
    `Steps captured: ${trace.length - 1}`,
    `Start line: ${start?.line ?? "<unknown>"}`,
    `End line: ${end?.line ?? "<unknown>"}`,
    `Stop reason: ${traceResult.stopReason ?? "none"}`,
  ];

  if (!anomaly) {
    return `${header.join("\n")}\nNo reverse scroll jump >= ${minReverseScrollPx}px detected.`;
  }

  const context = traceWindow(trace, anomaly.index, 1)
    .map((entry) => {
      const marker = entry.step === anomaly.current.step ? ">" : " ";
      return `${marker} step ${entry.step}: line=${entry.line} head=${entry.head} scrollTop=${entry.scrollTop} cursorTop=${entry.cursorTop ?? "null"} text=${JSON.stringify(entry.lineText)}`;
    })
    .join("\n");
  const nearbyLines = anomaly.current.nearbyLines.map(formatLineInfo).join("\n");

  return `${header.join("\n")}
Reverse scroll jump detected at step ${anomaly.current.step}:
  line ${anomaly.previous.line} -> ${anomaly.current.line}
  head ${anomaly.previous.head} -> ${anomaly.current.head}
  scrollTop ${anomaly.previous.scrollTop} -> ${anomaly.current.scrollTop} (${anomaly.scrollDelta > 0 ? "+" : ""}${anomaly.scrollDelta}px)
  cursorTop ${anomaly.previous.cursorTop ?? "null"} -> ${anomaly.current.cursorTop ?? "null"}${
    anomaly.cursorTopDelta === null ? "" : ` (${anomaly.cursorTopDelta > 0 ? "+" : ""}${anomaly.cursorTopDelta}px)`
  }
Trace window:
${context}
Nearby document context:
${nearbyLines}`;
}

export async function runCursorScrollRegression(page, options = {}) {
  const requestedFixture = resolveFixtureDocumentWithFallback(
    RANKDECREASE_CURSOR_FIXTURE,
    PUBLIC_CURSOR_FALLBACK,
  );
  const fixture = await openFixtureDocument(page, requestedFixture, {
    mode: "rich",
  });
  await assertEditorHealth(page, "cursor-scroll-regression: fixture-open", {
    maxVisibleDialogs: 2,
  });

  const traceResult = await traceVerticalCursorMotion(page, {
    direction: options.direction ?? "up",
    steps: options.steps ?? 250,
    startLine: options.startLine ?? requestedFixture.defaultLine ?? 900,
    startColumn: options.startColumn ?? 0,
    settleMs: options.settleMs ?? 150,
    contextRadius: options.contextRadius ?? 2,
  });
  const anomaly = findReverseScrollJump(traceResult.trace, {
    direction: traceResult.direction,
    minReverseScrollPx: options.minReverseScrollPx ?? 120,
  });

  return {
    fixture,
    traceResult,
    anomaly,
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/cursor-scroll-regression.mjs [options]

Options:
  --browser <managed|cdp>      Browser lane (default: managed)
  --headed                     Show the Playwright-owned browser window
  --port <n>                  CDP port for Chrome for Testing (default: 9322)
  --url <url>                 App URL Chrome is already running against
  --direction <up|down>       Cursor movement direction (default: up)
  --start-line <n>            1-based starting line (default: 900)
  --start-column <n>          0-based starting column (default: 0)
  --steps <n>                 Number of vertical moves to trace (default: 250)
  --settle-ms <n>             Extra settle time after each move (default: 150)
  --context-radius <n>        Nearby document lines to include (default: 2)
  --min-reverse-scroll-px <n> Reverse-scroll threshold in px (default: 120)
  --timeout <ms>              Browser/debug bridge timeout (default: 15000)
  --assert-clean              Exit non-zero if a reverse jump is found
  --expect-anomaly            Exit non-zero if no reverse jump is found
  --json                      Print the report as JSON
`);
}

export function resolveCursorScrollTimeout(argv) {
  const { getIntFlag } = createArgParser(argv);
  return getIntFlag("--timeout", 15000);
}

export async function main(argv = process.argv.slice(2)) {
  const { getFlag, getIntFlag, hasFlag } = createArgParser(argv);
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  if (hasFlag("--assert-clean") && hasFlag("--expect-anomaly")) {
    throw new Error("Choose at most one of --assert-clean and --expect-anomaly.");
  }

  const direction = getFlag("--direction", "up");
  if (direction !== "up" && direction !== "down") {
    throw new Error(`Unsupported direction "${direction}". Use up or down.`);
  }
  const timeout = resolveCursorScrollTimeout(argv);

  const session = await openBrowserSession(argv, { timeoutFallback: timeout });
  const { page } = session;
  try {
    await sleep(500);

    const result = await runCursorScrollRegression(page, {
      direction,
      startLine: getIntFlag("--start-line", 900),
      startColumn: getIntFlag("--start-column", 0),
      steps: getIntFlag("--steps", 250),
      settleMs: getIntFlag("--settle-ms", 150),
      contextRadius: getIntFlag("--context-radius", 2),
      minReverseScrollPx: getIntFlag("--min-reverse-scroll-px", 120),
    });

    const report = {
      fixture: {
        displayPath: result.fixture.displayPath,
        virtualPath: result.fixture.virtualPath,
        resolvedPath: result.fixture.resolvedPath,
        method: result.fixture.method,
      },
      direction: result.traceResult.direction,
      stepsCaptured: result.traceResult.trace.length - 1,
      stopReason: result.traceResult.stopReason,
      start: result.traceResult.trace[0] ?? null,
      end: result.traceResult.trace.at(-1) ?? null,
      anomaly: result.anomaly,
    };

    if (hasFlag("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatCursorScrollReport({
        fixture: result.fixture,
        traceResult: result.traceResult,
        anomaly: result.anomaly,
        minReverseScrollPx: getIntFlag("--min-reverse-scroll-px", 120),
      }));
    }

    if (hasFlag("--assert-clean") && result.anomaly) {
      process.exitCode = 1;
    } else if (hasFlag("--expect-anomaly") && !result.anomaly) {
      process.exitCode = 1;
    }
  } finally {
    await closeBrowserSession(session);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
