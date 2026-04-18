import { setRevealPresentation } from "../test-helpers.mjs";

export const name = "cursor-reveal-edge-cases";

async function openScratch(page, path, text) {
  await page.evaluate(async ({ path, text }) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale cleanup between cases.
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
  await page.waitForTimeout(200);
}

async function placeCaretInsideFirstText(page, selector, offset) {
  await page.evaluate(({ selector, offset }) => {
    const element = document.querySelector(selector);
    const walker = element ? document.createTreeWalker(element, NodeFilter.SHOW_TEXT) : null;
    const text = walker?.nextNode() ?? null;
    if (!text) {
      throw new Error(`missing text node for ${selector}`);
    }
    const range = document.createRange();
    range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { selector, offset });
  await page.waitForTimeout(250);
}

async function placeCaretAtVisibleText(page, textContent, edge) {
  await page.evaluate(({ edge, textContent }) => {
    const root = document.querySelector(".cf-lexical-editor--rich[contenteditable='true']");
    if (!root) {
      throw new Error("missing rich editor root");
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && text.textContent !== textContent) {
      text = walker.nextNode();
    }
    if (!text) {
      throw new Error(`missing visible text node ${JSON.stringify(textContent)}`);
    }
    root.focus({ preventScroll: true });
    const offset = edge === "end" ? text.textContent.length : 0;
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { edge, textContent });
  await page.waitForTimeout(250);
}

export async function run(page) {
  await setRevealPresentation(page, "inline");

  await openScratch(
    page,
    "scratch-heading-link-reveal.md",
    "# [Linked Heading](https://example.com) trailing\n\nNext paragraph.\n",
  );
  await placeCaretInsideFirstText(page, "h1.cf-lexical-heading a.cf-lexical-link", 3);
  const headingReveal = await page.evaluate(() => {
    const heading = document.querySelector("h1.cf-lexical-heading");
    return {
      hasNestedParagraph: Boolean(heading?.querySelector(":scope > .cf-lexical-paragraph")),
      text: heading?.textContent ?? "",
    };
  });
  if (headingReveal.hasNestedParagraph || !headingReveal.text.includes("[Linked Heading](https://example.com)")) {
    return {
      pass: false,
      message: `heading link reveal did not stay inline: ${JSON.stringify(headingReveal)}`,
    };
  }

  await openScratch(page, "scratch-inline-math-left-reveal.md", "Before $x+1$ after\n");
  await page.locator(".cf-lexical-inline-math").first().click({ position: { x: 1, y: 5 } });
  await page.waitForTimeout(250);
  const inlineMathLeft = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      anchorOffset: selection?.anchorOffset ?? null,
      anchorText: selection?.anchorNode?.textContent ?? "",
      text: document.querySelector('[data-testid="lexical-editor"]')?.textContent ?? "",
    };
  });
  if (inlineMathLeft.anchorText !== "$x+1$" || inlineMathLeft.anchorOffset === null || inlineMathLeft.anchorOffset > 1) {
    return {
      pass: false,
      message: `inline math left-edge reveal opened at the wrong offset: ${JSON.stringify(inlineMathLeft)}`,
    };
  }

  await openScratch(page, "scratch-inline-math-keyboard-forward.md", "Before $x+1$ after\n");
  await placeCaretAtVisibleText(page, "Before ", "end");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const inlineMathKeyboardForward = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      anchorOffset: selection?.anchorOffset ?? null,
      anchorText: selection?.anchorNode?.textContent ?? "",
      inlineMathStillRendered: Boolean(document.querySelector(".cf-lexical-inline-math")),
      text: document.querySelector('[data-testid="lexical-editor"]')?.textContent ?? "",
    };
  });
  if (
    inlineMathKeyboardForward.anchorText !== "$x+1$"
    || inlineMathKeyboardForward.anchorOffset === null
    || inlineMathKeyboardForward.anchorOffset > 1
    || inlineMathKeyboardForward.inlineMathStillRendered
  ) {
    return {
      pass: false,
      message: `ArrowRight into inline math did not reveal at the left edge: ${JSON.stringify(inlineMathKeyboardForward)}`,
    };
  }

  await openScratch(page, "scratch-inline-math-keyboard-backward.md", "Before $x+1$ after\n");
  await placeCaretAtVisibleText(page, " after", "start");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  const inlineMathKeyboardBackward = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      anchorOffset: selection?.anchorOffset ?? null,
      anchorText: selection?.anchorNode?.textContent ?? "",
      inlineMathStillRendered: Boolean(document.querySelector(".cf-lexical-inline-math")),
      text: document.querySelector('[data-testid="lexical-editor"]')?.textContent ?? "",
    };
  });
  if (
    inlineMathKeyboardBackward.anchorText !== "$x+1$"
    || inlineMathKeyboardBackward.anchorOffset !== 4
    || inlineMathKeyboardBackward.inlineMathStillRendered
  ) {
    return {
      pass: false,
      message: `ArrowLeft into inline math did not reveal at the right edge: ${JSON.stringify(inlineMathKeyboardBackward)}`,
    };
  }

  await openScratch(page, "scratch-inline-math-click-map.md", "Inline $a+b+c$ test.\n");
  await page.locator(".cf-lexical-inline-math [data-loc-start='1']").first().click({ force: true });
  await page.waitForTimeout(250);
  const inlineMathToken = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      anchorOffset: selection?.anchorOffset ?? null,
      anchorText: selection?.anchorNode?.textContent ?? "",
    };
  });
  if (
    inlineMathToken.anchorText !== "$a+b+c$"
    || inlineMathToken.anchorOffset === null
    || inlineMathToken.anchorOffset < 2
    || inlineMathToken.anchorOffset > 3
  ) {
    return {
      pass: false,
      message: `inline math token click did not map near the clicked source token: ${JSON.stringify(inlineMathToken)}`,
    };
  }

  await openScratch(
    page,
    "scratch-display-math-click-map.md",
    "Before\n\n$$\na+b+c\n$$\n\nAfter\n",
  );
  await page.locator(".cf-lexical-display-math [data-loc-start='1']").first().click({ force: true });
  await page.waitForTimeout(300);
  const displayMathToken = await page.evaluate(() => {
    const source = document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-structure-source-editor");
    const selection = window.getSelection();
    const offset = (() => {
      if (!source || !selection?.anchorNode) {
        return null;
      }
      const range = document.createRange();
      range.selectNodeContents(source);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return range.toString().length;
    })();
    return {
      offset,
      sourceText: source?.textContent ?? "",
    };
  });
  if (
    displayMathToken.offset === null
    || displayMathToken.offset <= 2
    || displayMathToken.offset >= displayMathToken.sourceText.length - 2
  ) {
    return {
      pass: false,
      message: `display math token click did not map into the formula body: ${JSON.stringify(displayMathToken)}`,
    };
  }

  await openScratch(
    page,
    "scratch-theorem-inline-reveal.md",
    "::: {.theorem} Test\nTheorem body has *italic* and [link](https://example.com).\n:::\n",
  );
  await placeCaretInsideFirstText(page, ".cf-lexical-block--theorem .cf-italic", 2);
  const theoremReveal = await page.evaluate(() => ({
    hasFloatingPanel: Boolean(document.querySelector(".cf-lexical-inline-token-panel-shell")),
    hasInlineRaw: (document.querySelector(".cf-lexical-block--theorem")?.textContent ?? "").includes("*italic*"),
  }));
  if (theoremReveal.hasFloatingPanel || !theoremReveal.hasInlineRaw) {
    return {
      pass: false,
      message: `nested theorem reveal ignored inline presentation: ${JSON.stringify(theoremReveal)}`,
    };
  }

  return {
    pass: true,
    message: "cursor reveal stays inline in headings/nested blocks and maps math keyboard/click entry to source offsets",
  };
}
