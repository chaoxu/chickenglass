/**
 * Regression test: table grid rendering.
 *
 * Verifies that pipe tables in the document are rendered as semantic table DOM
 * inside the table widget.
 */

/* global window */

import { openRegressionDocument, scrollToText, waitForRenderReady } from "../test-helpers.mjs";

export const name = "tables";

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

  return {
    pass: true,
    message:
      `${tableStatus.headerCellCount + tableStatus.bodyCellCount} table cells ` +
      `(${tableStatus.headerCellCount} headers) rendered`,
  };
}
