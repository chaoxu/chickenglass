/**
 * Regression test: table grid rendering.
 *
 * Verifies that pipe tables in the document are rendered with the grid layout
 * system (`.cf-grid-cell` elements).
 */

/* global window */

import { scrollToText } from "../test-helpers.mjs";

export const name = "tables";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));

  // Check for Table node in syntax tree
  const tree = await page.evaluate(() => window.__cmDebug.treeString());
  const hasTable = tree.includes("Table");

  if (!hasTable) {
    return { pass: false, message: "No Table node found in syntax tree" };
  }

  await scrollToText(page, "# Tables");

  // Check for rendered grid cells
  const cellCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-grid-cell").length;
  });

  if (cellCount === 0) {
    return { pass: false, message: "Table node exists but no .cf-grid-cell elements in DOM" };
  }

  // Verify header cells exist
  const headerCellCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-grid-cell-header").length;
  });

  return {
    pass: true,
    message: `${cellCount} grid cells (${headerCellCount} headers) rendered`,
  };
}
