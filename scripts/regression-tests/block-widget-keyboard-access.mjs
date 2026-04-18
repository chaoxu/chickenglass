import { openRegressionDocument, readEditorText, switchToMode } from "../test-helpers.mjs";

export const name = "block-widget-keyboard-access";

const DISPLAY_MARKER = "DisplayMathKeyboardNeedle";
const TABLE_MARKER = "TableKeyboardNeedle";

async function resetToRichIndex(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "lexical");
  await page.waitForTimeout(250);
}

async function openScratchDocument(page, path, text) {
  await page.evaluate(async ({ path, text }) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore cleanup between cases.
      }
    }
    app.setMode("lexical");
    await app.openFileWithContent(path, text);
  }, { path, text });
  await page.waitForFunction(
    ({ expected }) => window.__editor?.getDoc?.() === expected,
    { expected: text },
    { timeout: 10000 },
  );
  await page.waitForTimeout(250);
}

async function clickVisibleParagraph(page, text) {
  await page
    .locator(".cf-lexical-editor--rich[contenteditable='true'] > .cf-lexical-paragraph", { hasText: text })
    .click();
  await page.waitForTimeout(120);
}

async function clickVisibleHeading(page, text) {
  await page
    .locator(".cf-lexical-editor--rich[contenteditable='true'] > .cf-lexical-heading", { hasText: text })
    .click();
  await page.waitForTimeout(120);
}

export async function run(page) {
  await openScratchDocument(
    page,
    "scratch-display-math-horizontal-nav.md",
    "Before paragraph\n\n$$\nx+1\n$$\n\nAfter paragraph\n",
  );
  await page.evaluate(() => {
    const root = document.querySelector(".cf-lexical-editor--rich[contenteditable='true']");
    const paragraph = [...document.querySelectorAll(".cf-lexical-editor--rich > .cf-lexical-paragraph")]
      .find((element) => (element.textContent ?? "").includes("Before paragraph"));
    const text = paragraph ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode() : null;
    if (!root || !text) {
      throw new Error("missing before paragraph text");
    }
    root.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, text.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.waitForTimeout(120);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);

  const enteredDisplayWithArrowRight = await page.evaluate(() => ({
    editorOpen: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
    activeInsideDisplay: Boolean(
      document.activeElement?.closest(".cf-lexical-display-math"),
    ),
  }));
  if (!enteredDisplayWithArrowRight.editorOpen || !enteredDisplayWithArrowRight.activeInsideDisplay) {
    return { pass: false, message: "ArrowRight did not enter display-math editing from the previous paragraph edge" };
  }

  await resetToRichIndex(page);

  await clickVisibleParagraph(page, "Standard:");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(180);

  const enteredDisplayFromAbove = await page.evaluate(() => ({
    editorOpen: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
    activeInsideDisplay: Boolean(
      document.activeElement?.closest(".cf-lexical-display-math"),
    ),
  }));

  if (!enteredDisplayFromAbove.editorOpen || !enteredDisplayFromAbove.activeInsideDisplay) {
    return { pass: false, message: "ArrowDown did not enter display-math editing from above" };
  }

  await page.keyboard.type(DISPLAY_MARKER);
  await page.waitForTimeout(180);

  const displayEditState = await page.evaluate(() => ({
    editorOpen: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
    activeInsideDisplay: Boolean(
      document.activeElement?.closest(".cf-lexical-display-math"),
    ),
    text: document.querySelector(".cf-lexical-display-math.is-editing")?.textContent ?? "",
  }));
  if (!displayEditState.editorOpen || !displayEditState.activeInsideDisplay || !displayEditState.text.includes(DISPLAY_MARKER)) {
    return { pass: false, message: "typed text did not stay inside the display-math source editor" };
  }

  await page.keyboard.press("Tab");
  await page.waitForTimeout(220);

  const displayText = await readEditorText(page);
  if (!displayText.includes(DISPLAY_MARKER)) {
    return { pass: false, message: "display-math keyboard edits did not commit back into canonical markdown" };
  }

  await resetToRichIndex(page);

  await clickVisibleHeading(page, "Labeled Display Math and Equation References");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(120);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(180);

  const enteredDisplayFromBelow = await page.evaluate(() => ({
    editorOpen: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
    activeInsideDisplay: Boolean(
      document.activeElement?.closest(".cf-lexical-display-math"),
    ),
  }));

  if (!enteredDisplayFromBelow.editorOpen || !enteredDisplayFromBelow.activeInsideDisplay) {
    return { pass: false, message: "ArrowUp did not enter display-math editing from below" };
  }

  await resetToRichIndex(page);

  await clickVisibleParagraph(page, "Rich table for edit/display parity and stale-widget tests:");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(180);

  const tableEntry = await page.evaluate(() => ({
    activeInsideTable: (() => {
      const selection = window.getSelection();
      const anchorElement = selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      return Boolean(anchorElement?.closest(".cf-lexical-table-block"));
    })(),
  }));

  if (!tableEntry.activeInsideTable) {
    return { pass: false, message: "ArrowDown did not move the caret into the native table surface" };
  }

  await page.keyboard.type(TABLE_MARKER);
  await page.waitForTimeout(180);

  const tableText = await readEditorText(page);
  if (!tableText.includes(TABLE_MARKER)) {
    return { pass: false, message: "typed text did not reach the table editor" };
  }

  return {
    pass: true,
    message: "arrow-key navigation enters display math from both sides and focuses table editing",
  };
}
