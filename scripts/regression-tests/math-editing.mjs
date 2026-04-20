import {
  openRegressionDocument,
  readEditorText,
  setRevealPresentation,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "math-editing";
export const groups = ["core", "reveal"];

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
    inlineMathEditor: [...document.querySelectorAll(".cf-lexical-inline-token-panel-editor")]
      .some((editor) => editor instanceof HTMLInputElement && editor.value.startsWith("$")),
  }));
  if (hiddenByDefault.displayEditor || hiddenByDefault.inlineMathEditor) {
    return { pass: false, message: "math source editors should stay hidden until the formula is activated" };
  }

  await page.locator(".cf-lexical-inline-math").first().click();
  const inlineInput = page.locator(".cf-lexical-inline-token-panel-editor").first();
  await inlineInput.waitFor({ state: "visible", timeout: 5000 });
  const initialInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  await inlineInput.fill(INLINE_MARKER);
  await page.waitForFunction(
    ({ selector, width }) => {
      const input = document.querySelector(selector);
      return input instanceof HTMLElement && input.getBoundingClientRect().width > width;
    },
    { selector: ".cf-lexical-inline-token-panel-editor", width: initialInlineWidth },
    { timeout: 5000 },
  );

  const expandedInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  if (expandedInlineWidth <= initialInlineWidth) {
    return { pass: false, message: "inline math source field did not widen with longer source text" };
  }

  // Floating reveal commits on Enter/blur, not on every keystroke; press
  // Enter and then verify the markdown reflects the edit.
  await inlineInput.press("Enter");
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    INLINE_MARKER,
    { timeout: 5000 },
  );

  const liveText = await readEditorText(page);
  if (!liveText.includes(INLINE_MARKER)) {
    return { pass: false, message: "inline math edits did not flow into canonical markdown after committing the panel" };
  }

  await page.locator(".cf-lexical-display-math-body").first().click();
  await page.waitForFunction(
    () => Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-preview-equation .katex")),
    undefined,
    { timeout: 5000 },
  );

  const editingState = await page.evaluate(() => ({
    hasEditingEditor: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-editor")),
    hasEditingPreview: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-preview-shell")),
    hasEditingPreviewKatex: Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-preview-equation .katex")),
  }));
  if (!editingState.hasEditingEditor || !editingState.hasEditingPreview || !editingState.hasEditingPreviewKatex) {
    return { pass: false, message: `display math did not keep source editor and KaTeX preview visible: ${JSON.stringify(editingState)}` };
  }

  const displayEditor = page.locator(".cf-lexical-display-math.is-editing [contenteditable='true']").first();
  await displayEditor.fill(`$$\n${DISPLAY_MARKER}\n$$`);
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-display-math-preview-equation")?.textContent ?? "";
      return text.includes("q") && text.includes("r");
    },
    undefined,
    { timeout: 5000 },
  );
  const displayPreviewText = await page.locator(".cf-lexical-display-math.is-editing .cf-lexical-display-math-preview-equation").first().textContent();
  if (!displayPreviewText?.includes("q") || !displayPreviewText.includes("r")) {
    return { pass: false, message: `display math live preview did not update while editing: ${JSON.stringify(displayPreviewText)}` };
  }
  await displayEditor.press("Tab");
  await waitForBrowserSettled(page);

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
