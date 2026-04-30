#!/usr/bin/env node

import process from "node:process";
import { sleep } from "./browser-lifecycle.mjs";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import { createArgParser } from "./devx-cli.mjs";
import {
  openFixtureDocument,
  openRegressionDocument,
} from "./editor-test-helpers.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

const DEFAULT_URL = "http://localhost:5173";
const DEFAULT_STEP_PX = 90;
const DEFAULT_STEP_COUNT = 24;
const DEFAULT_SETTLE_MS = 120;
const DEFAULT_BOTTOM_OFFSET_PX = 2600;
const DEFAULT_MAX_DRIFT_PX = 2;
const DEFAULT_MAX_SCROLL_GUARDS = 0;
const DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;

function resolveTarget(parser) {
  const { getFlag } = parser;
  const fixture = getFlag("--fixture", undefined);
  const regression = getFlag("--regression", undefined);
  if (fixture && regression) {
    throw new Error("Choose only one of --fixture or --regression.");
  }
  if (fixture) {
    return {
      kind: "fixture",
      label: fixture,
      open: (page) => openFixtureDocument(
        page,
        { displayPath: `fixtures/${fixture}`, virtualPath: fixture },
        { mode: "rich" },
      ),
    };
  }
  const regressionPath = regression ?? "scroll-jump-showcase.md";
  return {
    kind: "regression",
    label: regressionPath,
    open: (page) => openRegressionDocument(page, regressionPath),
  };
}

function findWorstStep(samples, expectedStepPx) {
  let worst = null;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = current.scrollTop - previous.scrollTop;
    const drift = Math.abs(delta - expectedStepPx);
    if (!worst || drift > worst.drift) {
      worst = {
        index,
        previous,
        current,
        delta,
        drift,
        scrollHeightDelta: current.scrollHeight - previous.scrollHeight,
      };
    }
  }
  return worst;
}

function isEndClampedStep(previous, current, expectedStepPx) {
  if (expectedStepPx <= 0) return false;
  const remainingBeforeStep = Math.max(
    0,
    previous.maxScrollTop - previous.scrollTop,
  );
  return remainingBeforeStep < expectedStepPx
    && current.scrollTop === current.maxScrollTop;
}

function validateSamples(
  samples,
  {
    expectedStepPx,
    maxDriftPx,
    maxScrollGuards,
    scrollGuards,
  },
) {
  const failures = [];
  if (scrollGuards.length > maxScrollGuards) {
    failures.push(
      `scroll guard count ${scrollGuards.length} exceeds ${maxScrollGuards}`,
    );
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = current.scrollTop - previous.scrollTop;
    if (delta < 0) {
      failures.push(
        `${current.label} moved backward by ${Math.abs(delta)}px`,
      );
      continue;
    }

    if (isEndClampedStep(previous, current, expectedStepPx)) {
      continue;
    }

    const drift = Math.abs(delta - expectedStepPx);
    if (drift > maxDriftPx) {
      failures.push(
        `${current.label} drift ${drift}px exceeds ${maxDriftPx}px ` +
          `(delta ${delta}px, expected ${expectedStepPx}px)`,
      );
    }
  }

  return failures;
}

function printSamples(samples, expectedStepPx) {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = current.scrollTop - previous.scrollTop;
    const scrollHeightDelta = current.scrollHeight - previous.scrollHeight;
    const topLineDelta = current.topLine - previous.topLine;
    const viewportShift = `${previous.viewportFrom}-${previous.viewportTo} -> ${current.viewportFrom}-${current.viewportTo}`;
    console.log(
      [
        current.label,
        `dScroll=${delta}`,
        `drift=${delta - expectedStepPx}`,
        `dScrollHeight=${scrollHeightDelta}`,
        `topLine=${previous.topLine}->${current.topLine}`,
        `topLineDelta=${topLineDelta}`,
        `viewport=${viewportShift}`,
        `visibleDisplays=${current.visibleDisplayCount}`,
        `mountedDisplays=${current.mountedDisplayCount}`,
        `mountedLines=${current.mountedLineCount}`,
      ].join(" "),
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const parser = createArgParser(argv);
  const { getFlag, getIntFlag, hasFlag } = parser;
  const target = resolveTarget(parser);
  const url = getFlag("--url", DEFAULT_URL);
  const stepPx = getIntFlag("--step-px", DEFAULT_STEP_PX);
  const stepCount = getIntFlag("--step-count", DEFAULT_STEP_COUNT);
  const settleMs = getIntFlag("--settle-ms", DEFAULT_SETTLE_MS);
  const bottomOffsetPx = getIntFlag("--bottom-offset-px", DEFAULT_BOTTOM_OFFSET_PX);
  const maxDriftPx = getIntFlag("--max-drift-px", DEFAULT_MAX_DRIFT_PX);
  const maxScrollGuards = getIntFlag("--max-scroll-guards", DEFAULT_MAX_SCROLL_GUARDS);
  const timeout = getIntFlag("--timeout", DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS);
  const simulateWheel = hasFlag("--simulate-wheel");
  const assertClean = hasFlag("--assert-clean");

  const session = await openBrowserSession(argv, { timeoutFallback: timeout });
  const { page } = session;

  try {
    await target.open(page);
    await sleep(700);

    const result = await page.evaluate(
      async ({ stepPx, stepCount, settleMs, bottomOffsetPx, simulateWheel }) => {
        const view = window.__cmView;
        window.__cfDebug?.clearScrollGuards?.();
        const scroller = view.scrollDOM;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const settle = async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await wait(settleMs);
        };
        const sample = (label) => {
          const host = scroller.getBoundingClientRect();
          const topPos = view.lineBlockAtHeight(scroller.scrollTop).from;
          const bottomPos = view.lineBlockAtHeight(
            scroller.scrollTop + scroller.clientHeight,
          ).from;
          const displayNodes = Array.from(view.contentDOM.querySelectorAll(".cf-math-display"));
          const visibleDisplays = displayNodes.filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.bottom > host.top && rect.top < host.bottom;
          });
          return {
            label,
            scrollTop: Math.round(scroller.scrollTop),
            scrollHeight: Math.round(scroller.scrollHeight),
            maxScrollTop: Math.round(
              Math.max(0, scroller.scrollHeight - scroller.clientHeight),
            ),
            viewportFrom: view.state.doc.lineAt(view.viewport.from).number,
            viewportTo: view.state.doc.lineAt(view.viewport.to).number,
            topLine: view.state.doc.lineAt(topPos).number,
            bottomLine: view.state.doc.lineAt(bottomPos).number,
            visibleDisplayCount: visibleDisplays.length,
            mountedDisplayCount: displayNodes.length,
            mountedLineCount: view.contentDOM.querySelectorAll(".cm-line").length,
          };
        };

        const trace = [];
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - bottomOffsetPx,
        );
        await settle();
        trace.push(sample("start"));

        for (let index = 0; index < stepCount; index += 1) {
          if (simulateWheel) {
            scroller.dispatchEvent(new WheelEvent("wheel", {
              deltaY: stepPx,
              bubbles: true,
              cancelable: true,
            }));
          }
          scroller.scrollTop += stepPx;
          await settle();
          trace.push(sample(`down-${index}`));
        }

        return {
          samples: trace,
          scrollGuards: window.__cfDebug?.scrollGuards?.() ?? [],
        };
      },
      { stepPx, stepCount, settleMs, bottomOffsetPx, simulateWheel },
    );
    const { samples, scrollGuards } = result;

    console.log(`# scroll-jump-lab`);
    console.log(`target: ${target.kind}:${target.label}`);
    console.log(`url: ${url}`);
    console.log(`stepPx: ${stepPx}`);
    console.log(`stepCount: ${stepCount}`);
    console.log(`bottomOffsetPx: ${bottomOffsetPx}`);
    console.log(`simulateWheel: ${simulateWheel}`);
    printSamples(samples, stepPx);
    console.log(`scrollGuardCount: ${scrollGuards.length}`);
    if (scrollGuards.length > 0) {
      console.log("scroll-guards:");
      console.log(JSON.stringify(scrollGuards, null, 2));
    }

    const worst = findWorstStep(samples, stepPx);
    if (worst) {
      console.log("\nworst-step:");
      console.log(JSON.stringify(worst, null, 2));
    }

    if (assertClean) {
      const failures = validateSamples(samples, {
        expectedStepPx: stepPx,
        maxDriftPx,
        maxScrollGuards,
        scrollGuards,
      });
      if (failures.length > 0) {
        console.error("\nassertion failures:");
        for (const failure of failures) {
          console.error(`- ${failure}`);
        }
        process.exitCode = 1;
      } else {
        console.log(
          `\nassert-clean: pass (maxDriftPx=${maxDriftPx}, maxScrollGuards=${maxScrollGuards})`,
        );
      }
    }
  } finally {
    await closeBrowserSession(session);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
