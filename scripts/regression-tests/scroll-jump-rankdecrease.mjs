/**
 * Regression test: the known near-bottom wheel path on rankdecrease stays
 * monotonic in rich mode and does not need the reverse-remap guard.
 *
 * This is stronger than the generic scroll-stability check because it follows
 * the exact wheel-like path that previously reproduced the large backward jump.
 */

import {
  openFixtureDocument,
  waitForScrollReady,
} from "../test-helpers.mjs";
import { RANKDECREASE_MAIN_FIXTURE } from "../fixture-test-helpers.mjs";

export const name = "scroll-jump-rankdecrease";
export const optionalFixtures = true;

const STEP_PX = 90;
const STEP_COUNT = 24;
const STEP_SETTLE_MS = 120;
const BOTTOM_OFFSET_PX = 2600;
const REVERSE_TOLERANCE_PX = 40;
const DOWN_OVERSHOOT_TOLERANCE_PX = 40;
const MAX_MAX_SCROLL_DROP_PX = 128;

function describeSample(sample) {
  return `${sample.label}: scrollTop=${sample.scrollTop} maxScrollTop=${sample.maxScrollTop} topLine=${sample.topLine} viewport=L${sample.viewportFromLine}-L${sample.viewportToLine}`;
}

function findScrollAnomalies(samples) {
  const anomalies = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = current.scrollTop - previous.scrollTop;
    const maxScrollDrop = current.maxScrollTop - previous.maxScrollTop;

    if (delta < -REVERSE_TOLERANCE_PX) {
      anomalies.push(
        `reverse down-scroll ${describeSample(previous)} -> ${describeSample(current)} (${delta}px)`,
      );
      continue;
    }

    if (delta > STEP_PX + DOWN_OVERSHOOT_TOLERANCE_PX) {
      anomalies.push(
        `overshoot down-scroll ${describeSample(previous)} -> ${describeSample(current)} (+${delta}px)`,
      );
      continue;
    }

    if (maxScrollDrop < -MAX_MAX_SCROLL_DROP_PX) {
      anomalies.push(
        `maxScrollTop collapse ${describeSample(previous)} -> ${describeSample(current)} (${maxScrollDrop}px)`,
      );
    }
  }
  return anomalies;
}

function findWorstDrift(samples) {
  let worst = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].scrollTop - samples[index - 1].scrollTop;
    worst = Math.max(worst, Math.abs(delta - STEP_PX));
  }
  return worst;
}

export async function run(page) {
  await openFixtureDocument(page, RANKDECREASE_MAIN_FIXTURE, { mode: "rich" });
  await waitForScrollReady(page, { stableFrames: 3, timeoutMs: 10_000 });

  const result = await page.evaluate(
    async ({ stepPx, stepCount, settleMs, bottomOffsetPx }) => {
      const view = window.__cmView;
      const scroller = view.scrollDOM;
      window.__cfDebug?.clearScrollGuards?.();
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const settle = async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        // This fixed window is the measured scroll-probe cadence.
        await wait(settleMs);
      };
      const sample = (label) => {
        const topPos = view.lineBlockAtHeight(scroller.scrollTop).from;
        const bottomPos = view.lineBlockAtHeight(
          scroller.scrollTop + scroller.clientHeight,
        ).from;
        return {
          label,
          scrollTop: Math.round(scroller.scrollTop),
          maxScrollTop: Math.round(
            Math.max(0, scroller.scrollHeight - scroller.clientHeight),
          ),
          viewportFromLine: view.state.doc.lineAt(view.viewport.from).number,
          viewportToLine: view.state.doc.lineAt(view.viewport.to).number,
          topLine: view.state.doc.lineAt(topPos).number,
          bottomLine: view.state.doc.lineAt(bottomPos).number,
        };
      };

      const samples = [];
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight - bottomOffsetPx,
      );
      await settle();
      samples.push(sample("start"));

      for (let step = 0; step < stepCount; step += 1) {
        scroller.dispatchEvent(new WheelEvent("wheel", {
          deltaY: stepPx,
          bubbles: true,
          cancelable: true,
        }));
        scroller.scrollTop += stepPx;
        await settle();
        samples.push(sample(`down-${step}`));
      }

      return {
        samples,
        scrollGuards: window.__cfDebug?.scrollGuards?.() ?? [],
      };
    },
    {
      stepPx: STEP_PX,
      stepCount: STEP_COUNT,
      settleMs: STEP_SETTLE_MS,
      bottomOffsetPx: BOTTOM_OFFSET_PX,
    },
  );

  const { samples, scrollGuards } = result;
  const anomalies = findScrollAnomalies(samples);
  if (anomalies.length > 0) {
    return {
      pass: false,
      message: anomalies.slice(0, 3).join(" | "),
    };
  }

  if (scrollGuards.length > 0) {
    return {
      pass: false,
      message: `expected no scroll guards, saw ${scrollGuards.length}`,
    };
  }

  return {
    pass: true,
    message: `stable near-bottom wheel scroll (${samples.length} samples, worst drift ${findWorstDrift(samples)}px, guards=0)`,
  };
}
