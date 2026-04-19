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

  const tableCell = page
    .locator(".cf-lexical-table-block tbody td .cf-lexical-paragraph")
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

  const theoremTitleShell = page
    .locator("section.cf-lexical-block--theorem .cf-lexical-block-title")
    .first();
  await theoremTitleShell.click();
  const theoremTitle = theoremTitleShell.locator("[contenteditable='true']").first();
  await theoremTitle.waitFor({ state: "visible", timeout: 5000 });
  await theoremTitle.click();
  await page.waitForTimeout(150);
  // Move the caret to the end of the title before typing. Playwright's click()
  // lands at the visual centre, which would put the marker mid-word.
  await page.keyboard.press("Meta+A");
  await page.waitForTimeout(80);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(80);
  await page.keyboard.type(` ${TITLE_MARKER}`);
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    TITLE_MARKER,
    { timeout: 5000 },
  );
  const titleSelectionReady = await page.evaluate((marker) => {
    const root = document.querySelector("section.cf-lexical-block--theorem .cf-lexical-block-title [contenteditable='true']");
    if (!root) {
      return false;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = (node.textContent ?? "").indexOf(marker);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + marker.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      }
      node = walker.nextNode();
    }
    return false;
  }, TITLE_MARKER);
  if (!titleSelectionReady) {
    return { pass: false, message: "could not select theorem-title marker for nested format command" };
  }
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("cf:format", {
      detail: { type: "bold" },
    }));
  });
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(`**${marker}**`),
    TITLE_MARKER,
    { timeout: 5000 },
  );

  await page.waitForFunction(() => window.__app?.isDirty?.() ?? false);
  const text = await readEditorText(page);
  const dirty = await page.evaluate(() => window.__app?.isDirty?.() ?? false);
  const theoremTitleLine = text.match(/:::: \{#thm:hover-preview \.theorem\} .*/m)?.[0] ?? "";

  if (!dirty) {
    return { pass: false, message: "nested lexical edits did not mark the document dirty" };
  }

  if (!text.includes(BLOCK_MARKER)) {
    return { pass: false, message: "theorem-body edit did not flow back into canonical markdown" };
  }

  if (!text.includes(CELL_MARKER)) {
    return { pass: false, message: "table-cell edit did not flow back into canonical markdown" };
  }

  if (!theoremTitleLine.includes(`**${TITLE_MARKER}**`)) {
    return {
      pass: false,
      message: `nested theorem-title format did not flow back into canonical markdown. Title line: ${JSON.stringify(theoremTitleLine)}`,
    };
  }

  if (!text.includes(MATH_MARKER)) {
    return { pass: false, message: "display-math edit did not flow back into canonical markdown" };
  }

  return {
    pass: true,
    message: "nested theorem, formatted title, table, and math edits propagated into canonical markdown",
  };
}
