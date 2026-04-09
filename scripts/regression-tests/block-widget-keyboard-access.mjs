/**
 * Regression test: block widgets must be reachable from the keyboard.
 *
 * Covers the two important entry paths:
 * - Arrow navigation into hidden display-math blocks should reveal source.
 * - Arrow navigation into hidden table widgets should open a cell editor.
 */

import {
  findLine,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "block-widget-keyboard-access";

async function resetToRichIndex(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
}

export async function run(page) {
  await resetToRichIndex(page);

  const standardLine = await findLine(page, "Standard:");
  if (standardLine < 0) {
    return { pass: false, message: 'missing "Standard:" display-math anchor' };
  }

  await setCursor(page, standardLine, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await page.keyboard.type("X");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const displayDown = await page.evaluate(() => ({
    structure: window.__cmDebug.structure(),
    selection: window.__cmDebug.selection(),
    sourceLine: (() => {
      const structure = window.__cmDebug.structure();
      if (!structure || structure.kind !== "display-math") return null;
      return window.__cmView.state.doc.lineAt(structure.from).text;
    })(),
    motionGuards: window.__cmDebug.motionGuards(),
  }));

  if (displayDown.structure?.kind !== "display-math") {
    return {
      pass: false,
      message: "ArrowDown did not enter display-math structure edit",
    };
  }

  if (!displayDown.sourceLine?.startsWith("$$X")) {
    return {
      pass: false,
      message: `display-math source was not editable after ArrowDown: ${JSON.stringify(displayDown.sourceLine)}`,
    };
  }

  await resetToRichIndex(page);

  const backslashLine = await findLine(page, "Backslash:");
  if (backslashLine < 0) {
    return { pass: false, message: 'missing "Backslash:" display-math anchor' };
  }

  await setCursor(page, backslashLine, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await page.keyboard.press("ArrowUp");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await page.keyboard.press("ArrowUp");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const displayUp = await page.evaluate(() => ({
    structure: window.__cmDebug.structure(),
    motionGuards: window.__cmDebug.motionGuards(),
  }));

  if (displayUp.structure?.kind !== "display-math") {
    return {
      pass: false,
      message: "ArrowUp did not enter display-math structure edit from below",
    };
  }

  await resetToRichIndex(page);

  const firstTableLine = await findLine(page, "| Algorithm | Time | Space |");
  if (firstTableLine < 0) {
    return { pass: false, message: "missing first table source line" };
  }

  await setCursor(page, firstTableLine - 1, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await page.keyboard.type("Z");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const tableEntry = await page.evaluate(() => {
    const editingCell = document.querySelector(".cf-table-cell-editing");
    return {
      editingCells: document.querySelectorAll(".cf-table-cell-editing").length,
      nestedEditors: document.querySelectorAll(".cf-table-cell-editing .cm-editor").length,
      text: editingCell?.textContent ?? "",
      motionGuards: window.__cmDebug.motionGuards(),
    };
  });

  if (tableEntry.editingCells === 0 || tableEntry.nestedEditors === 0) {
    return {
      pass: false,
      message: "ArrowDown did not open a table cell editor",
    };
  }

  if (!tableEntry.text.startsWith("Z")) {
    return {
      pass: false,
      message: `typed input did not reach the table editor: ${JSON.stringify(tableEntry.text)}`,
    };
  }

  return {
    pass: true,
    message: "keyboard entered display math from both sides and opened a table cell editor",
  };
}
