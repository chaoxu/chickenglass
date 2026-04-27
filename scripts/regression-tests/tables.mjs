/**
 * Regression test: table grid rendering.
 *
 * Verifies that pipe tables in the document are rendered as semantic table DOM
 * inside the table widget.
 */

/* global window */

import {
  openEditorScenario,
  openRegressionDocument,
  readEditorText,
  scrollToText,
  settleEditorLayout,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "tables";

async function assertKeyboardTableAuthoring(page) {
  await openEditorScenario(page, {
    entry: "keyboard-table-authoring.md",
    files: {
      "keyboard-table-authoring.md": "",
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });

  await page.locator(".cm-content").first().click();
  await page.keyboard.type("| A | B |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("| --- |");
  await settleEditorLayout(page, { frameCount: 2, delayMs: 16 });

  const partialSeparatorDoc = await readEditorText(page);
  if (partialSeparatorDoc !== "| A | B |\n| --- |") {
    return `incomplete separator row was normalized early: ${JSON.stringify(partialSeparatorDoc)}`;
  }

  await page.keyboard.type(" --- |");
  await page.keyboard.press("Enter");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 32 });

  const afterSeparator = await page.evaluate(() => ({
    doc: window.__editor.getDoc(),
    editingCells: document.querySelectorAll(".cf-table-cell-editing").length,
  }));

  if (afterSeparator.editingCells !== 1) {
    return `completed table did not open a cell editor: ${JSON.stringify(afterSeparator)}`;
  }

  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Escape");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 32 });

  const finalDoc = await readEditorText(page);
  if (finalDoc !== "| A   | B   |\n| --- | --- |\n| 1   | 2   |") {
    return `keyboard-authored table row was not preserved: ${JSON.stringify(finalDoc)}`;
  }

  return null;
}

export async function run(page) {
  await openRegressionDocument(page);
  await waitForRenderReady(page);

  // Check for Table node in syntax tree
  const tree = await page.evaluate(() => window.__cmDebug.treeString());
  const hasTable = tree.includes("Table");

  if (!hasTable) {
    return { pass: false, message: "No Table node found in syntax tree" };
  }

  await scrollToText(page, "# Tables");

  // Check for rendered table cells
  const tableStatus = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return {
      widgetCount: editor.querySelectorAll(".cf-table-widget").length,
      headerCellCount: editor.querySelectorAll(".cf-table-widget thead th").length,
      bodyCellCount: editor.querySelectorAll(".cf-table-widget tbody td").length,
    };
  });

  if (
    tableStatus.widgetCount === 0 ||
    tableStatus.headerCellCount === 0 ||
    tableStatus.bodyCellCount === 0
  ) {
    return {
      pass: false,
      message:
        `Table node exists but rendered semantic table DOM is missing ` +
        `(widgets=${tableStatus.widgetCount}, headers=${tableStatus.headerCellCount}, body=${tableStatus.bodyCellCount})`,
    };
  }

  const authoringError = await assertKeyboardTableAuthoring(page);
  if (authoringError) {
    return { pass: false, message: authoringError };
  }

  return {
    pass: true,
    message:
      `${tableStatus.headerCellCount + tableStatus.bodyCellCount} table cells ` +
      `(${tableStatus.headerCellCount} headers) rendered; keyboard table authoring preserved`,
  };
}
