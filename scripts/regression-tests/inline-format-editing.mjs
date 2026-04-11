import {
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "inline-format-editing";

const LEFT_EXIT_MARKER = "LeftInlineExitNeedle";
const RIGHT_EXIT_MARKER = "RightInlineExitNeedle";
const UPDATED_BOLD = "Native Bold text";
const UPDATED_CODE = "inline code edited";
const UPDATED_ITALIC = "italic text edited";

function inlineToken(page, selector, text) {
  return page.locator(selector).filter({ hasText: text }).first();
}

async function placeCaretInsideToken(page, selector, text, edge) {
  const placed = await page.evaluate(({ nextEdge, nextSelector, nextText }) => {
    const token = [...document.querySelectorAll(nextSelector)].find((candidate) =>
      (candidate.textContent ?? "").includes(nextText)
    );
    if (!(token instanceof HTMLElement)) {
      return false;
    }

    const walker = document.createTreeWalker(token, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (!(current instanceof Text)) {
        continue;
      }
      const value = current.textContent ?? "";
      const index = value.indexOf(nextText);
      if (index < 0) {
        continue;
      }

      const selection = window.getSelection();
      if (!selection) {
        return false;
      }

      const range = document.createRange();
      const offset = nextEdge === "start"
        ? index
        : index + nextText.length;
      range.setStart(current, offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      const root = token.closest("[contenteditable='true']");
      if (root instanceof HTMLElement) {
        root.focus();
      }
      return true;
    }

    return false;
  }, {
    nextEdge: edge,
    nextSelector: selector,
    nextText: text,
  });

  if (!placed) {
    throw new Error(`failed to place caret ${edge} ${JSON.stringify(text)}`);
  }

  await page.waitForTimeout(120);
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const clickChecks = [];
    for (const token of [
      { selector: ".cf-bold", text: "Bold text", visibleText: "Bold text" },
      { selector: ".cf-italic", text: "italic text", visibleText: "italic text" },
      { selector: ".cf-strikethrough", text: "strikethrough", visibleText: "strikethrough" },
      { selector: ".cf-highlight", text: "highlight", visibleText: "highlight" },
      { selector: ".cf-inline-code", text: "inline code", visibleText: "inline code" },
    ]) {
      await inlineToken(page, token.selector, token.text).click();
      await page.waitForTimeout(120);
      clickChecks.push({
        expectedText: token.visibleText,
        selector: token.selector,
        sourceEditors: await page.locator(".cf-lexical-inline-format-source").count(),
        text: await inlineToken(page, token.selector, token.visibleText).textContent(),
      });
    }

    await placeCaretInsideToken(page, ".cf-italic", "italic text", "end");
    await page.keyboard.type(" edited");
    await page.waitForTimeout(180);

    await placeCaretInsideToken(page, ".cf-bold", "Bold text", "start");
    await page.keyboard.type("Native ");
    await page.waitForTimeout(180);

    await placeCaretInsideToken(page, ".cf-inline-code", "inline code", "end");
    await page.keyboard.type(" edited");
    await page.waitForTimeout(180);

    await placeCaretInsideToken(page, ".cf-italic", UPDATED_ITALIC, "end");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.type(RIGHT_EXIT_MARKER);
    await page.waitForTimeout(150);

    await placeCaretInsideToken(page, ".cf-italic", UPDATED_ITALIC, "start");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(100);
    await page.keyboard.type(LEFT_EXIT_MARKER);
    await page.waitForTimeout(150);

    return {
      clickChecks,
      markdown: await readEditorText(page),
      sourceEditors: await page.locator(".cf-lexical-inline-format-source").count(),
    };
  }, {
    ignoreConsole: ["[vite] connecting...", "[vite] connected."],
    ignorePageErrors: [
      /Cache storage is disabled because the context is sandboxed/,
    ],
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during inline-format editing: ${formatRuntimeIssues(issues)}`,
    };
  }

  for (const check of value.clickChecks) {
    if (check.sourceEditors !== 0) {
      return {
        pass: false,
        message: `${check.selector} still revealed an inline markdown source node on click`,
      };
    }

    if ((check.text ?? "").trim() !== check.expectedText) {
      return {
        pass: false,
        message: `${check.selector} changed visible text unexpectedly when activated`,
      };
    }
  }

  if (value.sourceEditors !== 0) {
    return {
      pass: false,
      message: "inline markdown source nodes were still mounted after rich-text edits",
    };
  }

  if (!value.markdown.includes(`**${UPDATED_BOLD}**`)) {
    return {
      pass: false,
      message: "bold text no longer edits in place as a native formatted span",
    };
  }

  if (!value.markdown.includes(`*${UPDATED_ITALIC}*`)) {
    return {
      pass: false,
      message: "italic text no longer edits in place as a native formatted span",
    };
  }

  if (!value.markdown.includes(`\`${UPDATED_CODE}\``)) {
    return {
      pass: false,
      message: "inline code no longer edits in place as a native formatted span",
    };
  }

  const italicSpanIndex = value.markdown.indexOf(`*${UPDATED_ITALIC}*`);
  const leftMarkerIndex = value.markdown.indexOf(LEFT_EXIT_MARKER);
  const rightMarkerIndex = value.markdown.indexOf(RIGHT_EXIT_MARKER);
  if (
    italicSpanIndex < 0
    || leftMarkerIndex < 0
    || rightMarkerIndex < 0
    || !(leftMarkerIndex < italicSpanIndex && italicSpanIndex < rightMarkerIndex)
  ) {
    return {
      pass: false,
      message: "caret movement around inline formats stopped returning typing to the surrounding document flow",
    };
  }

  return {
    pass: true,
    message: "formatted text stays rendered on click, edits in place, and exits cleanly without a source-node phase",
  };
}
