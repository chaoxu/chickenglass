import {
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "rankdecrease-proposition-proof-arrowdown-after-sweep";
export const optionalFixtures = true;

function selectionSignature(page) {
  return page.evaluate(() => {
    const root = window.__cmDebug.selection();
    const scroller = window.__cmView?.scrollDOM;
    const structure = window.__cmDebug.structure()?.kind ?? null;
    return {
      rootHead: root.head,
      rootLine: root.line,
      rootCol: root.col,
      structure,
      editorScrollTop: Math.round(scroller?.scrollTop ?? 0),
    };
  });
}

async function preconditionWithLongArrowDown(page) {
  let stableSteps = 0;
  let previous = await selectionSignature(page);

  for (let step = 0; step < 1600; step += 1) {
    await page.keyboard.press("ArrowDown");
    if (step % 50 === 0) {
      await settleEditorLayout(page, { frameCount: 1, delayMs: 10 });
    }

    const state = await selectionSignature(page);
    if (state.rootLine === previous.rootLine && state.rootHead === previous.rootHead) {
      stableSteps += 1;
      if (stableSteps >= 10) return state;
    } else {
      stableSteps = 0;
    }
    previous = state;
  }

  return previous;
}

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md");
  await switchToMode(page, "rich");
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await preconditionWithLongArrowDown(page);

  await openRegressionDocument(page, "rankdecrease/main.md");
  await switchToMode(page, "rich");
  await setCursor(page, 1033, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  let previousState = await selectionSignature(page);
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 1, delayMs: 30 });
    const state = await selectionSignature(page);

    if (state.rootLine < previousState.rootLine) {
      return {
        pass: false,
        message: `ArrowDown moved backward near proposition/proof boundary after long sweep: ${JSON.stringify({ step, previousState, state })}`,
      };
    }
    if (state.rootLine - previousState.rootLine > 20) {
      return {
        pass: false,
        message: `ArrowDown jumped too far near proposition/proof boundary after long sweep: ${JSON.stringify({ step, previousState, state })}`,
      };
    }

    previousState = state;
    if (state.rootLine >= 1047) {
      return {
        pass: true,
        message: `ArrowDown crossed proposition/proof boundary after long sweep at line ${state.rootLine}`,
      };
    }
  }

  return {
    pass: false,
    message: `ArrowDown did not reach the proof body after long sweep: ${JSON.stringify(previousState)}`,
  };
}
