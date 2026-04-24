import {
  openRegressionDocument,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "rankdecrease-arrowdown-sweep";

function selectionSignature(page) {
  return page.evaluate(() => {
    const root = window.__cmDebug.selection();
    const scroller = window.__cmView?.scrollDOM;
    const structure = window.__cmDebug.structure()?.kind ?? null;
    return {
      docLines: window.__cmView.state.doc.lines,
      rootHead: root.head,
      rootLine: root.line,
      rootCol: root.col,
      structure,
      editorScrollTop: Math.round(scroller?.scrollTop ?? 0),
    };
  });
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

  let repeated = 0;
  let previousSignature = null;
  let previousState = null;
  let state = await selectionSignature(page);

  for (let step = 0; step < 4000; step += 1) {
    state = await selectionSignature(page);
    if (previousState) {
      if (state.rootLine < previousState.rootLine) {
        return {
          pass: false,
          message: `ArrowDown moved backward in rankdecrease lines: ${JSON.stringify({ step, previousState, state })}`,
        };
      }
      if (state.editorScrollTop + 40 < previousState.editorScrollTop) {
        return {
          pass: false,
          message: `ArrowDown scrolled backward in rankdecrease: ${JSON.stringify({ step, previousState, state })}`,
        };
      }
    }

    const signature = JSON.stringify(state);
    if (signature === previousSignature) {
      repeated += 1;
    } else {
      repeated = 0;
      previousSignature = signature;
    }
    previousState = state;

    if (repeated >= 3) {
      if (state.rootLine >= state.docLines) {
        return {
          pass: true,
          message: `ArrowDown swept rankdecrease to document end at line ${state.rootLine}`,
        };
      }
      return {
        pass: false,
        message: `ArrowDown stalled in rankdecrease before document end: ${JSON.stringify({ step, repeated, state })}`,
      };
    }

    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 1, delayMs: 30 });
  }

  return {
    pass: false,
    message: `ArrowDown did not settle in rankdecrease within the sweep budget: ${JSON.stringify(state)}`,
  };
}
