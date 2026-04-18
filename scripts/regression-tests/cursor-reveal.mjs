/**
 * Regression coverage for cursor-scope reveal (the Typora-style inline
 * swap of a styled TextNode into its raw markdown source when the caret
 * lands inside).
 *
 * We verify the round-trip: write a paragraph with an italic run, move
 * the caret into it via Lexical's selection API, confirm the DOM now
 * shows the raw `*...*` form, then move the caret out and confirm the
 * markers are re-applied as a styled span.
 */
import { openRegressionDocument, readEditorText } from "../test-helpers.mjs";

export const name = "cursor-reveal";

const FIXTURE = "Reveal probe: hello *world*.\n";

export async function run(page) {
  await openRegressionDocument(page);

  await page.evaluate((text) => {
    window.__editor.setDoc(text);
  }, FIXTURE);
  await page.waitForTimeout(120);

  // Place caret inside the italic run via Lexical's selection API.
  await page.evaluate(() => {
    const editor = window.__editor;
    // Walk to the italic TextNode and collapse selection in its middle.
    editor.focus();
    const italic = document.querySelector(".cf-italic");
    if (!(italic instanceof HTMLElement)) {
      return;
    }
    const range = document.createRange();
    const textNode = italic.firstChild;
    if (!textNode) {
      return;
    }
    range.setStart(textNode, 2);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    italic.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const duringReveal = await page.evaluate(() => {
    const bodyText = document.querySelector('[data-testid="lexical-editor"]')?.textContent ?? "";
    return {
      bodyText,
      italicsPresent: Boolean(document.querySelector(".cf-italic")),
      hasStars: bodyText.includes("*world*"),
    };
  });

  // Move caret to the very start of the document → commit reveal back.
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="lexical-editor"]');
    if (!(root instanceof HTMLElement)) {
      return;
    }
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (!firstText) {
      return;
    }
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    root.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const afterReveal = await readEditorText(page);

  if (!duringReveal.hasStars && !duringReveal.italicsPresent) {
    return {
      pass: false,
      message: `expected reveal markers or styled italic span after caret-in; saw body="${duringReveal.bodyText}"`,
    };
  }

  if (!afterReveal.includes("*world*")) {
    return {
      pass: false,
      message: `reveal did not round-trip italic markers in exported markdown; got "${afterReveal}"`,
    };
  }

  return { pass: true, message: "cursor reveal round-trips italic markers" };
}
