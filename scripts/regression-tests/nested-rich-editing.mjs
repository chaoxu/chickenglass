import {
  openRegressionDocument,
  readEditorText,
} from "../test-helpers.mjs";

export const name = "nested-rich-editing";

const BLOCK_MARKER = "NestedBlockEditNeedle";
const CELL_MARKER = "NestedCellEditNeedle";
const MATH_MARKER = "NestedMathEditNeedle";
const TITLE_MARKER = "NestedTitleEditNeedle";

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const theoremBody = page
    .locator("section.cf-lexical-block--theorem .cf-lexical-nested-editor--block-body")
    .first();
  await theoremBody.click();
  await page.keyboard.type(` ${BLOCK_MARKER}`);
  await page.waitForTimeout(250);

  const theoremTitle = page
    .locator("section.cf-lexical-block--theorem .cf-lexical-nested-editor--title")
    .first();
  await theoremTitle.click();
  await page.waitForTimeout(150);
  await page.keyboard.type(` ${TITLE_MARKER}`);
  await page.waitForTimeout(250);

  const tableCell = page
    .locator(".cf-lexical-table-block tbody td .cf-lexical-nested-editor--table-cell")
    .first();
  await tableCell.click();
  await page.keyboard.type(` ${CELL_MARKER}`);
  await page.waitForTimeout(250);

  const mathSource = page
    .locator(".cf-lexical-display-math-body")
    .first();
  await mathSource.click();
  await page.waitForTimeout(150);
  const mathEditor = page
    .locator(".cf-lexical-display-math.is-editing .cf-lexical-structure-source-editor--math")
    .first();
  await mathEditor.click();
  await page.keyboard.type(` ${MATH_MARKER}`);
  await page.waitForTimeout(250);

  const text = await readEditorText(page);
  const dirty = await page.evaluate(() => window.__app?.isDirty?.() ?? false);

  if (!dirty) {
    return { pass: false, message: "nested lexical edits did not mark the document dirty" };
  }

  if (!text.includes(BLOCK_MARKER)) {
    return { pass: false, message: "theorem-body edit did not flow back into canonical markdown" };
  }

  if (!text.includes(CELL_MARKER)) {
    return { pass: false, message: "table-cell edit did not flow back into canonical markdown" };
  }

  if (!text.includes(TITLE_MARKER)) {
    return { pass: false, message: "theorem-title edit did not flow back into canonical markdown" };
  }

  if (!text.includes(MATH_MARKER)) {
    return { pass: false, message: "display-math edit did not flow back into canonical markdown" };
  }

  return {
    pass: true,
    message: "nested theorem, title, table, and math edits propagated into canonical markdown",
  };
}
