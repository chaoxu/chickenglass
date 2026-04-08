/**
 * Regression test: rich-mode scrolling stays monotonic near the bottom of
 * the rankdecrease fixture.
 *
 * This catches height-map snaps caused by rich-render geometry disagreeing
 * with CM6's own layout model. The test intentionally walks the scroller
 * near the bottom in fixed increments and fails on large unsolicited jumps
 * or reverse motion.
 */

import { openFixtureDocument, sleep } from "../test-helpers.mjs";

export const name = "scroll-stability";

const STEP_PX = 180;
const STEP_COUNT = 8;
const STEP_SETTLE_MS = 120;
const DOWN_OVERSHOOT_TOLERANCE_PX = 120;
const UP_OVERSHOOT_TOLERANCE_PX = 120;
const REVERSE_TOLERANCE_PX = 40;

const RANKDECREASE_FIXTURE = {
  displayPath: "fixtures/rankdecrease/main.md",
  virtualPath: "rankdecrease/main.md",
};

function describeSample(sample) {
  return `${sample.label}: scrollTop=${sample.scrollTop} topLine=${sample.topLine} viewport=L${sample.viewportFromLine}-L${sample.viewportToLine}`;
}

function findScrollAnomalies(samples) {
  const anomalies = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = current.scrollTop - previous.scrollTop;
    const currentIsDown = current.label.startsWith("down-");
    const currentIsUp = current.label.startsWith("up-");

    if (currentIsDown) {
      if (delta < -REVERSE_TOLERANCE_PX) {
        anomalies.push(
          `reverse down-scroll ${describeSample(previous)} -> ${describeSample(current)} (${delta}px)`,
        );
      } else if (delta > STEP_PX + DOWN_OVERSHOOT_TOLERANCE_PX) {
        anomalies.push(
          `overshoot down-scroll ${describeSample(previous)} -> ${describeSample(current)} (+${delta}px)`,
        );
      }
    }

    if (currentIsUp) {
      if (delta > REVERSE_TOLERANCE_PX) {
        anomalies.push(
          `reverse up-scroll ${describeSample(previous)} -> ${describeSample(current)} (+${delta}px)`,
        );
      } else if (delta < -(STEP_PX + UP_OVERSHOOT_TOLERANCE_PX)) {
        anomalies.push(
          `overshoot up-scroll ${describeSample(previous)} -> ${describeSample(current)} (${delta}px)`,
        );
      }
    }
  }
  return anomalies;
}

export async function run(page) {
  await openFixtureDocument(page, RANKDECREASE_FIXTURE, { mode: "rich" });
  await sleep(600);

  const samples = await page.evaluate(
    async ({ stepPx, stepCount, settleMs }) => {
      const view = window.__cmView;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const settle = async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await wait(settleMs);
      };
      const sample = (label) => {
        const topPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
        const bottomPos = view.lineBlockAtHeight(
          view.scrollDOM.scrollTop + view.scrollDOM.clientHeight,
        ).from;
        return {
          label,
          scrollTop: Math.round(view.scrollDOM.scrollTop),
          viewportFromLine: view.state.doc.lineAt(view.viewport.from).number,
          viewportToLine: view.state.doc.lineAt(view.viewport.to).number,
          topLine: view.state.doc.lineAt(topPos).number,
          bottomLine: view.state.doc.lineAt(bottomPos).number,
        };
      };

      const trace = [];
      view.scrollDOM.scrollTop = Math.max(
        0,
        view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight - 2200,
      );
      await settle();
      trace.push(sample("start"));

      for (let step = 0; step < stepCount; step += 1) {
        view.scrollDOM.scrollTop += stepPx;
        await settle();
        trace.push(sample(`down-${step}`));
      }

      for (let step = 0; step < stepCount; step += 1) {
        view.scrollDOM.scrollTop -= stepPx;
        await settle();
        trace.push(sample(`up-${step}`));
      }

      return trace;
    },
    {
      stepPx: STEP_PX,
      stepCount: STEP_COUNT,
      settleMs: STEP_SETTLE_MS,
    },
  );

  const anomalies = findScrollAnomalies(samples);
  if (anomalies.length > 0) {
    return {
      pass: false,
      message: anomalies.slice(0, 3).join(" | "),
    };
  }

  return {
    pass: true,
    message: `stable near-bottom rich scroll (${samples.length} samples)`,
  };
}
