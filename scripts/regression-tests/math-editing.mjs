import { openRegressionDocument, readEditorText, setRevealPresentation } from "../test-helpers.mjs";

export const name = "math-editing";

const INLINE_MARKER = "$\\frac{z^2 + \\alpha_1 + \\alpha_2}{1 + \\beta_1 + \\beta_2}$";
const DISPLAY_MARKER = "q^2 = r^2";

export async function run(page) {
  // Inline math source editing happens through the floating panel input
  // (cf-lexical-inline-math-source). The default reveal is now inline-swap,
  // which would surface a plain text node instead of the panel input below.
  await setRevealPresentation(page, "floating");
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const hiddenByDefault = await page.evaluate(() => ({
    displayEditor: Boolean(document.querySelector(".cf-lexical-display-math-editor")),
    inlineEditor: Boolean(document.querySelector(".cf-lexical-inline-token-panel-editor")),
    panelShell: Boolean(document.querySelector(".cf-lexical-inline-token-panel-shell")),
  }));
  if (hiddenByDefault.displayEditor || hiddenByDefault.inlineEditor || hiddenByDefault.panelShell) {
    return { pass: false, message: "math source editors should stay hidden until the formula is activated" };
  }

  await page.locator(".cf-lexical-inline-math").first().click();
  const inlineInput = page.locator(".cf-lexical-inline-token-panel-editor").first();
  const initialInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  await inlineInput.fill(INLINE_MARKER);
  await page.waitForTimeout(150);

  const expandedInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  if (expandedInlineWidth <= initialInlineWidth) {
    return { pass: false, message: "inline math source field did not widen with longer source text" };
  }

  // Floating reveal commits on Enter/blur, not on every keystroke; press
  // Enter and then verify the markdown reflects the edit.
  await inlineInput.press("Enter");
  await page.waitForTimeout(200);

  const liveText = await readEditorText(page);
  if (!liveText.includes(INLINE_MARKER)) {
    return { pass: false, message: "inline math edits did not flow into canonical markdown after committing the panel" };
  }

  await page.locator(".cf-lexical-display-math-body").first().click();
  await page.waitForTimeout(150);

  const editingState = await page.evaluate(() => ({
    hasEditingBody: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-body")),
    hasEditingEditor: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
  }));
  if (editingState.hasEditingBody || !editingState.hasEditingEditor) {
    return { pass: false, message: "display math did not switch cleanly into source-edit mode" };
  }

  const displayEditor = page.locator(".cf-lexical-display-math.is-editing [contenteditable='true']").first();
  await displayEditor.fill(`$$\n${DISPLAY_MARKER}\n$$`);
  await displayEditor.press("Tab");
  await page.waitForTimeout(200);

  const text = await readEditorText(page);
  if (!text.includes(INLINE_MARKER)) {
    return { pass: false, message: "inline math edits did not flow back into canonical markdown" };
  }
  if (!text.includes(DISPLAY_MARKER)) {
    return { pass: false, message: "display math edits did not flow back into canonical markdown" };
  }

  return {
    pass: true,
    message: "inline and display math activate source editing only on demand and persist back into markdown",
  };
}
