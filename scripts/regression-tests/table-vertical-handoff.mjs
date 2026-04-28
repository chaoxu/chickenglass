import {
  clearMotionGuards,
  clearStructure,
  findLine,
  getSelectionState,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "table-vertical-handoff";

function snapshot(page) {
  return Promise.all([
    getSelectionState(page),
    page.evaluate(() => {
    const active = document.activeElement;
    return {
      editingCells: document.querySelectorAll(".cf-table-cell-editing").length,
      activeCells: document.querySelectorAll(".cf-table-cell-active").length,
      activeTag: active?.tagName ?? null,
      activeClass: active?.className ?? null,
    };
    }),
  ]).then(([selection, domState]) => ({
    ...domState,
    line: selection.line,
    col: selection.col,
    head: selection.head,
  }));
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const firstTableLine = await findLine(page, "| Algorithm | Time | Space |");
  const afterTableLine = await findLine(
    page,
    "Rich table for edit/display parity and stale-widget tests:",
  );
  if (firstTableLine < 0 || afterTableLine < 0) {
    return {
      pass: false,
      message: `missing table anchors: ${JSON.stringify({ firstTableLine, afterTableLine })}`,
    };
  }

  await setCursor(page, firstTableLine - 1, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
  });
  await clearStructure(page);
  await clearMotionGuards(page);
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });

  let entered = false;
  let exited = false;
  let lastState = await snapshot(page);

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
    lastState = await snapshot(page);
    if (lastState.editingCells > 0 || lastState.activeCells > 0) {
      entered = true;
    }
    if (
      entered &&
      lastState.editingCells === 0 &&
      lastState.activeCells === 0 &&
      lastState.line >= afterTableLine
    ) {
      exited = true;
      break;
    }
  }

  if (!entered) {
    return {
      pass: false,
      message: `ArrowDown never entered the first table: ${JSON.stringify(lastState)}`,
    };
  }

  if (!exited) {
    return {
      pass: false,
      message:
        `ArrowDown entered the first table but did not hand off below it: ` +
        `${JSON.stringify({ afterTableLine, lastState })}`,
    };
  }

  return {
    pass: true,
    message: `ArrowDown entered the first table and resumed root motion at line ${lastState.line}`,
  };
}
