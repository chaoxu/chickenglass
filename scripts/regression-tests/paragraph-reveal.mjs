/**
 * Regression coverage for paragraph-scope reveal: when the user selects
 * "Paragraph reveal" mode and the caret enters a top-level block, the
 * whole block surfaces as raw markdown source. Editing the source and
 * moving the caret out re-parses and splices the resulting block(s)
 * back into the live tree.
 */
import { openRegressionDocument, readEditorText } from "../test-helpers.mjs";

export const name = "paragraph-reveal";

const FIXTURE = "Paragraph reveal probe with *italic* and **bold** runs.\n\nSibling block used as a commit target.\n";

async function setMode(page, mode) {
  await page.evaluate(async (nextMode) => {
    window.__app.setMode(nextMode);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, mode);
}

async function placeCaretInFirstParagraph(page) {
  await page.evaluate(() => {
    const paragraph = document.querySelector(".cf-lexical-paragraph, p");
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }
    paragraph.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const range = document.createRange();
    const firstText = paragraph.firstChild ?? paragraph;
    if (firstText.nodeType === Node.TEXT_NODE && firstText.textContent) {
      range.setStart(firstText, Math.min(8, firstText.textContent.length));
    } else {
      range.selectNodeContents(paragraph);
      range.collapse(true);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    paragraph.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
}

export async function run(page) {
  await openRegressionDocument(page);

  // Reset to a known mode first to avoid mode persistence bleed. We
  // can't use `__editor.setDoc` here: switching modes remounts the
  // Lexical surface with the React-side doc prop (which `setDoc`
  // bypasses), reverting our fixture. `openFileWithContent` updates
  // the React-owned source of truth so the next mode switch keeps it.
  await setMode(page, "lexical");
  await page.evaluate(async (text) => {
    if (window.__app.getCurrentDocument?.()) {
      await window.__app.closeFile({ discard: true });
    }
    await window.__app.openFileWithContent(`scratch-paragraph-reveal-${Date.now()}.md`, text);
  }, FIXTURE);
  await page.waitForTimeout(200);

  await setMode(page, "paragraph");

  // Cursor enters the paragraph — paragraph adapter should swap the
  // styled children for a single plain TextNode showing the raw markdown.
  await placeCaretInFirstParagraph(page);
  await page.waitForTimeout(200);

  const duringReveal = await page.evaluate(() => {
    const paragraph = document.querySelector(".cf-lexical-paragraph, p");
    return {
      bodyText: paragraph?.textContent ?? "",
      hasItalicSpan: !!document.querySelector(".cf-italic"),
      hasBoldSpan: !!document.querySelector(".cf-bold"),
    };
  });

  if (!duringReveal.bodyText.includes("*italic*")) {
    return {
      pass: false,
      message: `paragraph reveal did not surface raw italic markers; saw "${duringReveal.bodyText}"`,
    };
  }
  if (duringReveal.hasItalicSpan || duringReveal.hasBoldSpan) {
    return {
      pass: false,
      message: "expected styled italic/bold spans to be replaced by raw source while paragraph is revealed",
    };
  }

  // Move the caret out of the revealed paragraph by clicking into the
  // *next* block, forcing SELECTION_CHANGE to fire the commit. We can't
  // just call setSelection(0, 0): that lands at offset 0 of the very
  // text node we're revealing (it's the first run in the doc), so the
  // plugin sees the caret as still inside the reveal and skips commit.
  await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll(".cf-lexical-paragraph, p")];
    const sibling = paragraphs[1] ?? document.querySelector(".cf-lexical-heading, h1, h2, h3");
    if (!(sibling instanceof HTMLElement)) {
      return;
    }
    const range = document.createRange();
    const firstText = sibling.firstChild;
    if (firstText && firstText.nodeType === Node.TEXT_NODE) {
      range.setStart(firstText, 0);
    } else {
      range.selectNodeContents(sibling);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.waitForTimeout(250);

  const afterReveal = (await readEditorText(page)).trim();

  if (!afterReveal.includes("*italic*") || !afterReveal.includes("**bold**")) {
    return {
      pass: false,
      message: `paragraph reveal did not round-trip italic/bold markers; got "${afterReveal}"`,
    };
  }

  // Block-type change: open the paragraph again and prepend `# ` to it,
  // then commit. The paragraph should become a heading.
  await placeCaretInFirstParagraph(page);
  await page.waitForTimeout(200);

  await page.keyboard.press("Home");
  await page.keyboard.type("# ");
  await page.waitForTimeout(150);

  // Move caret out to commit (same constraint as above — must land in a
  // *different* block than the revealed one).
  await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll(".cf-lexical-paragraph, p, .cf-lexical-heading, h1, h2, h3")];
    const sibling = paragraphs[1];
    if (!(sibling instanceof HTMLElement)) {
      return;
    }
    const range = document.createRange();
    const firstText = sibling.firstChild;
    if (firstText && firstText.nodeType === Node.TEXT_NODE) {
      range.setStart(firstText, 0);
    } else {
      range.selectNodeContents(sibling);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.waitForTimeout(250);

  const afterHeading = (await readEditorText(page)).trim();
  if (!afterHeading.startsWith("# Paragraph reveal probe")) {
    return {
      pass: false,
      message: `paragraph reveal did not reparse edited source as a heading: ${JSON.stringify(afterHeading)}`,
    };
  }

  // Reset mode for downstream tests.
  await setMode(page, "lexical");

  return { pass: true, message: "paragraph reveal round-trips italic/bold markers" };
}
