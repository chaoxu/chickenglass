import { openAndSettleRegressionDocument } from "../test-helpers.mjs";

export const name = "tables";
export const groups = ["surfaces"];

export async function run(page) {
  await openAndSettleRegressionDocument(page, "index.md");

  const state = await page.evaluate(() => ({
    cellCount: document.querySelectorAll("table td, table th").length,
    tableCount: document.querySelectorAll(".cf-lexical-table-block table, table").length,
    tree: window.__cmDebug?.treeString?.() ?? "",
  }));

  if (!state.tree.includes("coflat-table")) {
    return { pass: false, message: "debug tree did not report a markdown table" };
  }

  if (state.tableCount === 0 || state.cellCount === 0) {
    return { pass: false, message: "rich mode did not render the table grid" };
  }

  return {
    pass: true,
    message: `${state.tableCount} tables rendered with ${state.cellCount} cells`,
  };
}
