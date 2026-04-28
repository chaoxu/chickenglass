import {
  clearMotionGuards,
  clearStructure,
  getSelectionState,
  getStructureState,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "rankdecrease-proposition-proof-arrowdown";
export const optionalFixtures = true;

function selectionSignature(page) {
  return Promise.all([
    getSelectionState(page),
    getStructureState(page),
    page.evaluate(() => {
    const scroller = window.__cmView?.scrollDOM;
    return {
      editorScrollTop: Math.round(scroller?.scrollTop ?? 0),
    };
    }),
  ]).then(([root, structure, domState]) => ({
    ...domState,
    rootHead: root.head,
    rootLine: root.line,
    rootCol: root.col,
    structure: structure?.kind ?? null,
  }));
}

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md");
  await switchToMode(page, "rich");
  await setCursor(page, 1033, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
  });
  await clearStructure(page);
  await clearMotionGuards(page);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  let previousState = await selectionSignature(page);
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 1, delayMs: 30 });
    const state = await selectionSignature(page);

    if (state.rootLine < previousState.rootLine) {
      return {
        pass: false,
        message: `ArrowDown moved backward near proposition/proof boundary: ${JSON.stringify({ step, previousState, state })}`,
      };
    }
    if (state.rootLine - previousState.rootLine > 20) {
      return {
        pass: false,
        message: `ArrowDown jumped too far near proposition/proof boundary: ${JSON.stringify({ step, previousState, state })}`,
      };
    }

    previousState = state;
    if (state.rootLine >= 1047) {
      return {
        pass: true,
        message: `ArrowDown crossed proposition/proof boundary at line ${state.rootLine}`,
      };
    }
  }

  return {
    pass: false,
    message: `ArrowDown did not reach the proof body near the proposition boundary: ${JSON.stringify(previousState)}`,
  };
}
