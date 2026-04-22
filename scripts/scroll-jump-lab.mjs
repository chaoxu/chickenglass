#!/usr/bin/env node

import process from "node:process";
import {
  connectEditor,
  openFixtureDocument,
  openRegressionDocument,
  sleep,
  waitForDebugBridge,
} from "./test-helpers.mjs";

const DEFAULT_URL = "http://localhost:5173";
const DEFAULT_STEP_PX = 90;
const DEFAULT_STEP_COUNT = 24;
const DEFAULT_SETTLE_MS = 120;
const DEFAULT_BOTTOM_OFFSET_PX = 2600;

function getFlag(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function getIntFlag(name, fallback) {
  const raw = getFlag(name, undefined);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`Invalid integer value for ${name}: ${raw}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer value for ${name}: ${raw}`);
  }
  return parsed;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveTarget() {
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

async function main() {
  const target = resolveTarget();
  const url = getFlag("--url", DEFAULT_URL);
  const stepPx = getIntFlag("--step-px", DEFAULT_STEP_PX);
  const stepCount = getIntFlag("--step-count", DEFAULT_STEP_COUNT);
  const settleMs = getIntFlag("--settle-ms", DEFAULT_SETTLE_MS);
  const bottomOffsetPx = getIntFlag("--bottom-offset-px", DEFAULT_BOTTOM_OFFSET_PX);
  const timeout = getIntFlag("--timeout", 15000);
  const simulateWheel = hasFlag("--simulate-wheel");

  const page = await connectEditor({
    browser: "managed",
    headless: !hasFlag("--headed"),
    timeout,
    url,
  });

  try {
    await waitForDebugBridge(page, { timeout });
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
  } finally {
    await page.context().browser()?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
