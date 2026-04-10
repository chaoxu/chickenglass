import { openRegressionDocument, readEditorText } from "../test-helpers.mjs";

export const name = "math-editing";

const INLINE_MARKER = "$\\frac{z^2 + \\alpha_1 + \\alpha_2}{1 + \\beta_1 + \\beta_2}$";
const DISPLAY_MARKER = "q^2 = r^2";
const LEFT_EXIT_MARKER = "LeftExitNeedle";
const RIGHT_EXIT_MARKER = "RightExitNeedle";

async function placeCaretAroundFirstInlineMath(page, side) {
  const placed = await page.evaluate((targetSide) => {
    const math = document.querySelector(".cf-lexical-inline-math");
    const decorator = math?.closest("[data-lexical-decorator='true']");
    const editor = decorator?.closest("[contenteditable='true']");
    if (!(math instanceof HTMLElement) || !(decorator instanceof HTMLElement) || !(editor instanceof HTMLElement)) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    const findTextNode = (startNode, direction) => {
      let current = startNode;
      while (current) {
        if (current instanceof Text && (current.textContent?.length ?? 0) > 0) {
          return current;
        }
        if (current instanceof HTMLElement) {
          const walker = document.createTreeWalker(current, NodeFilter.SHOW_TEXT);
          let candidate = null;
          for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
            if ((textNode.textContent?.length ?? 0) > 0) {
              candidate = textNode;
              if (direction === "next") {
                return candidate;
              }
            }
          }
          if (candidate) {
            return candidate;
          }
        }
        current = direction === "previous" ? current.previousSibling : current.nextSibling;
      }
      return null;
    };

    const textNode = targetSide === "before"
      ? findTextNode(decorator.previousSibling, "previous")
      : findTextNode(decorator.nextSibling, "next");
    if (!(textNode instanceof Text)) {
      return false;
    }

    const range = document.createRange();
    const offset = targetSide === "before"
      ? textNode.textContent?.length ?? 0
      : 0;
    range.setStart(textNode, offset);
    range.collapse(true);

    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, side);

  if (!placed) {
    throw new Error(`failed to place visible caret ${side} the first inline math node`);
  }

  await page.waitForTimeout(150);
}

async function setInlineMathSourceCaret(page, position) {
  await page.evaluate((targetPosition) => {
    const input = document.querySelector(".cf-lexical-inline-math-source");
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const caret = targetPosition === "end" ? input.value.length : 0;
    input.focus();
    input.setSelectionRange(caret, caret);
  }, position);
  await page.waitForTimeout(100);
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const hiddenByDefault = await page.evaluate(() => ({
    displayEditor: Boolean(document.querySelector(".cf-lexical-display-math-editor")),
    inlineEditor: Boolean(document.querySelector(".cf-lexical-inline-math-source")),
  }));
  if (hiddenByDefault.displayEditor || hiddenByDefault.inlineEditor) {
    return { pass: false, message: "math source editors should stay hidden until the formula is activated" };
  }

  await page.locator(".cf-lexical-inline-math").first().click();
  const inlineInput = page.locator(".cf-lexical-inline-math-source").first();
  const initialInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  await inlineInput.fill(INLINE_MARKER);
  await page.waitForTimeout(150);

  const expandedInlineWidth = await inlineInput.evaluate((node) => node.getBoundingClientRect().width);
  if (expandedInlineWidth <= initialInlineWidth) {
    return { pass: false, message: "inline math source field did not widen with longer source text" };
  }

  const liveText = await readEditorText(page);
  if (!liveText.includes(INLINE_MARKER)) {
    return { pass: false, message: "inline math did not update canonical markdown in real time while editing" };
  }

  await inlineInput.press("Enter");
  await page.waitForTimeout(150);

  await placeCaretAroundFirstInlineMath(page, "before");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);

  const entryFromLeft = await page.evaluate(() => {
    const input = document.querySelector(".cf-lexical-inline-math-source");
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    return {
      selectionEnd: input.selectionEnd,
      selectionStart: input.selectionStart,
      value: input.value,
    };
  });
  if (!entryFromLeft || entryFromLeft.selectionStart !== 0 || entryFromLeft.selectionEnd !== 0) {
    return { pass: false, message: "caret entry from the left did not open inline math at source start" };
  }

  await setInlineMathSourceCaret(page, "end");
  await page.locator(".cf-lexical-inline-math-source").first().press("ArrowRight");
  await page.keyboard.type(RIGHT_EXIT_MARKER);
  await page.waitForTimeout(150);

  await placeCaretAroundFirstInlineMath(page, "after");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(150);

  const entryFromRight = await page.evaluate(() => {
    const input = document.querySelector(".cf-lexical-inline-math-source");
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    return {
      selectionEnd: input.selectionEnd,
      selectionStart: input.selectionStart,
      value: input.value,
    };
  });
  if (!entryFromRight || entryFromRight.selectionStart !== entryFromRight.value.length || entryFromRight.selectionEnd !== entryFromRight.value.length) {
    return { pass: false, message: "caret entry from the right did not open inline math at source end" };
  }

  await setInlineMathSourceCaret(page, "start");
  await page.locator(".cf-lexical-inline-math-source").first().press("ArrowLeft");
  await page.keyboard.type(LEFT_EXIT_MARKER);
  await page.waitForTimeout(150);

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
  if (!text.includes(`${LEFT_EXIT_MARKER}${INLINE_MARKER}${RIGHT_EXIT_MARKER}`)) {
    return { pass: false, message: "inline math boundary exits did not return typing to the surrounding document" };
  }
  if (!text.includes(DISPLAY_MARKER)) {
    return { pass: false, message: "display math edits did not flow back into canonical markdown" };
  }

  return {
    pass: true,
    message: "inline and display math activate source editing only on demand and persist back into markdown",
  };
}
