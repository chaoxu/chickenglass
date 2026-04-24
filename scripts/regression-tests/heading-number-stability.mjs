import {
  openFixtureDocument,
  settleEditorLayout,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "heading-number-stability";
export const optionalFixtures = true;

const FIXTURE = "rankdecrease/main.md";
const NEEDLE = "# Introduction";

function summarizeSamples(samples, baselineCount) {
  const counts = samples.map((sample) => sample.stateCount);
  return {
    maxCount: Math.max(...counts),
    minCount: Math.min(...counts),
    sampleCount: samples.length,
    transientLowCount: samples.filter((sample) => sample.stateCount < baselineCount).length,
    uniqueCounts: [...new Set(counts)].sort((a, b) => a - b),
  };
}

async function sectionNumberSnapshot(page) {
  return page.evaluate(() => {
    const view = window.__cmView;
    if (!view) {
      throw new Error("window.__cmView is unavailable");
    }

    const stateNumbers = [];
    for (const value of view.state.values) {
      if (!value || typeof value !== "object" || typeof value.iter !== "function") {
        continue;
      }

      const iterator = value.iter();
      while (iterator.value) {
        const number = iterator.value.spec?.attributes?.["data-section-number"];
        if (number !== undefined) {
          stateNumbers.push({
            from: iterator.from,
            number,
          });
        }
        iterator.next();
      }
    }

    return {
      domCount: view.dom.querySelectorAll("[data-section-number]").length,
      stateCount: stateNumbers.length,
      stateNumbers,
    };
  });
}

async function placeCursorInsideHeading(page) {
  return page.evaluate((needle) => {
    const view = window.__cmView;
    if (!view) {
      throw new Error("window.__cmView is unavailable");
    }

    const doc = view.state.doc.toString();
    const headingStart = doc.indexOf(needle);
    if (headingStart < 0) {
      throw new Error(`Missing heading ${JSON.stringify(needle)}`);
    }
    const markerEnd = needle.indexOf(" ") + 1;
    const cursor = headingStart + markerEnd;

    view.dispatch({
      selection: { anchor: cursor },
      scrollIntoView: true,
    });
    view.focus();
    return cursor;
  }, NEEDLE);
}

async function splitAndRestoreHeading(page, cursor) {
  await page.evaluate((pos) => {
    const view = window.__cmView;
    view.dispatch({
      changes: { from: pos, insert: "\n" },
      selection: { anchor: pos + 1 },
      scrollIntoView: true,
    });
  }, cursor);
  await page.waitForTimeout(50);

  await page.evaluate((pos) => {
    const view = window.__cmView;
    view.dispatch({
      changes: { from: pos - 1, to: pos },
      selection: { anchor: pos - 1 },
      scrollIntoView: true,
    });
  }, cursor + 1);
  await page.waitForTimeout(50);
}

async function sampleDuringStructuralEdits(page, baselineCount) {
  return page.evaluate(async ({ expectedMinimum, iterations, needle }) => {
    const view = window.__cmView;
    if (!view) {
      throw new Error("window.__cmView is unavailable");
    }

    const readStateCount = () => {
      let count = 0;
      for (const value of view.state.values) {
        if (!value || typeof value !== "object" || typeof value.iter !== "function") {
          continue;
        }

        const iterator = value.iter();
        while (iterator.value) {
          if (iterator.value.spec?.attributes?.["data-section-number"] !== undefined) {
            count += 1;
          }
          iterator.next();
        }
      }
      return count;
    };

    const doc = view.state.doc.toString();
    const headingStart = doc.indexOf(needle);
    if (headingStart < 0) {
      throw new Error(`Missing heading ${JSON.stringify(needle)}`);
    }
    const cursor = headingStart + needle.indexOf(" ") + 1;
    view.dispatch({
      selection: { anchor: cursor },
      scrollIntoView: true,
    });
    view.focus();

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const samples = [];
    let running = true;
    const sampler = (async () => {
      while (running) {
        samples.push({
          stateCount: readStateCount(),
          time: performance.now(),
        });
        await sleep(5);
      }
    })();

    for (let index = 0; index < iterations; index += 1) {
      const currentCursor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: currentCursor, insert: "\n" },
        selection: { anchor: currentCursor + 1 },
        scrollIntoView: true,
      });
      await sleep(50);
      view.dispatch({
        changes: { from: currentCursor, to: currentCursor + 1 },
        selection: { anchor: currentCursor },
        scrollIntoView: true,
      });
      await sleep(50);
    }

    await sleep(700);
    running = false;
    await sampler;

    return {
      expectedMinimum,
      samples,
    };
  }, {
    expectedMinimum: baselineCount,
    iterations: 5,
    needle: NEEDLE,
  });
}

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, {
    mode: "cm6-rich",
    project: "full-project",
  });
  await waitForRenderReady(page, { selector: "[data-section-number]" });

  const cursor = await placeCursorInsideHeading(page);
  await splitAndRestoreHeading(page, cursor);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const before = await sectionNumberSnapshot(page);
  if (before.stateCount === 0) {
    return {
      pass: false,
      message: "No section-number decorations found before structural edit probe",
    };
  }

  const { samples } = await sampleDuringStructuralEdits(page, before.stateCount);
  const after = await sectionNumberSnapshot(page);
  const summary = summarizeSamples(samples, before.stateCount);

  const stable =
    summary.transientLowCount === 0 &&
    summary.minCount >= before.stateCount &&
    after.stateCount >= before.stateCount;

  return {
    pass: stable,
    message:
      `before=${before.stateCount}, after=${after.stateCount}, ` +
      `samples=${summary.sampleCount}, min=${summary.minCount}, ` +
      `max=${summary.maxCount}, transientLow=${summary.transientLowCount}`,
  };
}
