import { openFixtureDocument, sleep } from "../test-helpers.mjs";
import { resolveFixtureDocumentWithFallback } from "../test-helpers/fixtures.mjs";

export const name = "scroll-stability";

const STEP_PX = 180;
const STEP_COUNT = 8;
const STEP_SETTLE_MS = 120;
const DOWN_OVERSHOOT_TOLERANCE_PX = 120;
const UP_OVERSHOOT_TOLERANCE_PX = 120;
const REVERSE_TOLERANCE_PX = 40;

const HEAVY_FIXTURE = {
  displayPath: "fixtures/rankdecrease/main.md",
  virtualPath: "rankdecrease/main.md",
};
const PUBLIC_SCROLL_FALLBACK = {
  displayPath: "demo/index.md",
  virtualPath: "index.md",
};

function describeSample(sample) {
  return `${sample.label}: scrollTop=${sample.scrollTop}`;
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
        anomalies.push(`reverse down-scroll ${describeSample(previous)} -> ${describeSample(current)} (${delta}px)`);
      } else if (delta > STEP_PX + DOWN_OVERSHOOT_TOLERANCE_PX) {
        anomalies.push(`overshoot down-scroll ${describeSample(previous)} -> ${describeSample(current)} (+${delta}px)`);
      }
    }

    if (currentIsUp) {
      if (delta > REVERSE_TOLERANCE_PX) {
        anomalies.push(`reverse up-scroll ${describeSample(previous)} -> ${describeSample(current)} (+${delta}px)`);
      } else if (delta < -(STEP_PX + UP_OVERSHOOT_TOLERANCE_PX)) {
        anomalies.push(`overshoot up-scroll ${describeSample(previous)} -> ${describeSample(current)} (${delta}px)`);
      }
    }
  }
  return anomalies;
}

export async function run(page) {
  const fixture = resolveFixtureDocumentWithFallback(HEAVY_FIXTURE, PUBLIC_SCROLL_FALLBACK);
  await openFixtureDocument(page, fixture, { mode: "lexical" });
  await sleep(600);

  const samples = await page.evaluate(
    async ({ stepPx, stepCount, settleMs }) => {
      const scroller = document.querySelector('[data-testid="lexical-editor"]');
      if (!(scroller instanceof HTMLElement)) {
        throw new Error("visible lexical editor scroller is missing");
      }

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const settle = async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await wait(settleMs);
      };
      const sample = (label) => ({
        label,
        scrollTop: Math.round(scroller.scrollTop),
      });

      const trace = [];
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 2200);
      await settle();
      trace.push(sample("start"));

      for (let step = 0; step < stepCount; step += 1) {
        scroller.scrollTop += stepPx;
        await settle();
        trace.push(sample(`down-${step}`));
      }

      for (let step = 0; step < stepCount; step += 1) {
        scroller.scrollTop -= stepPx;
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
    message: `stable rich scroll on ${fixture.displayPath} (${samples.length} samples)`,
  };
}
