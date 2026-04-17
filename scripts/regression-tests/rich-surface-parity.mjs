/**
 * Regression coverage for rich-token rendering inside table cells.
 *
 * The legacy contract was "clicking a cell does not change visible rich
 * tokens." That guarantee no longer holds under the cursor-reveal feature —
 * a click that lands on a styled span or a link decoratively swaps the token
 * for its raw markdown source. So this test instead asserts:
 *
 *   1. Each table cell renders the expected rich tokens before activation
 *      (KaTeX, citations, highlights, inline code, links).
 *   2. Clicking the cell focuses the nested editor (caret inside the cell).
 *   3. Clicking on a plain-text region of the cell preserves the surrounding
 *      rich tokens — only the token under the caret is allowed to reveal.
 */
import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "rich-surface-parity";

function getContentCell(page, label) {
  return page
    .locator(`.cf-lexical-table-block tr:has-text("${label}")`)
    .first()
    .locator("td")
    .nth(1);
}

async function readCell(page, label) {
  const cell = getContentCell(page, label);
  if (await cell.count() === 0) {
    return null;
  }

  return cell.evaluate((element) => {
    const normalizeText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
    const selection = window.getSelection();
    const anchorElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    return {
      citationCount: element.querySelectorAll(".cf-citation").length,
      codeCount: element.querySelectorAll(".cf-inline-code").length,
      hasSelection: Boolean(anchorElement && element.contains(anchorElement)),
      highlightCount: element.querySelectorAll(".cf-highlight").length,
      katexCount: element.querySelectorAll(".katex").length,
      linkCount: element.querySelectorAll("a.cf-lexical-link").length,
      text: normalizeText(element.innerText),
    };
  });
}

/**
 * Place the caret on a plain-text run inside the cell — somewhere that none
 * of the rich tokens (links, code, math, citation) covers. That keeps the
 * cursor-reveal feature from swapping a styled span for its raw source as a
 * side effect of the click.
 */
async function clickPlainTextInsideCell(page, label) {
  const cell = getContentCell(page, label);
  return cell.evaluate((element) => {
    const RICH_SELECTORS = [
      ".cf-bold", ".cf-italic", ".cf-strikethrough", ".cf-highlight",
      ".cf-inline-code", ".cf-citation", "a.cf-lexical-link",
      ".cf-lexical-inline-math", "[data-coflat-reference='true']",
    ];
    const isInsideRichToken = (node) => {
      let cursor = node instanceof Element ? node : node.parentElement;
      while (cursor && cursor !== element) {
        if (RICH_SELECTORS.some((sel) => cursor?.matches?.(sel))) return true;
        cursor = cursor.parentElement;
      }
      return false;
    };

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (text.trim().length > 0 && !isInsideRichToken(node)) {
        const range = document.createRange();
        range.setStart(node, Math.min(1, text.length - 1));
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const editor = element.closest("[contenteditable='true']");
        if (editor instanceof HTMLElement) editor.focus();
        element.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        return true;
      }
      node = walker.nextNode();
    }
    return false;
  });
}

async function captureParity(page, label) {
  const before = await readCell(page, label);
  if (!before) {
    return null;
  }
  const placed = await clickPlainTextInsideCell(page, label);
  await page.waitForTimeout(160);
  const after = await readCell(page, label);
  return { after, before, placed };
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const state = {
    citation: await captureParity(page, "citation + highlight"),
    code: await captureParity(page, "code + link"),
    math: await captureParity(page, "emphasis + math"),
  };

  if (!state.math || !state.citation || !state.code) {
    return { pass: false, message: "rich table parity fixture did not render the expected rows" };
  }

  for (const [label, parity] of Object.entries(state)) {
    if (!parity.placed) {
      return { pass: false, message: `${label} cell had no plain-text region to click` };
    }
    if (!parity.after?.hasSelection) {
      return { pass: false, message: `${label} cell did not place the caret inside the native table cell` };
    }
  }

  if (state.math.before.katexCount !== 1 || state.math.after?.katexCount !== 1) {
    return { pass: false, message: "math table cell lost KaTeX rendering when caret landed on a plain-text run" };
  }
  if (state.citation.before.citationCount !== 1 || state.citation.after?.citationCount !== 1) {
    return { pass: false, message: "citation table cell lost citation rendering when caret landed on a plain-text run" };
  }
  if (state.citation.before.highlightCount !== 1 || state.citation.after?.highlightCount !== 1) {
    return { pass: false, message: "citation table cell lost highlight rendering when caret landed on a plain-text run" };
  }
  if (state.code.before.codeCount !== 1 || state.code.after?.codeCount !== 1) {
    return { pass: false, message: "code/link table cell lost inline code rendering when caret landed on a plain-text run" };
  }
  if (state.code.before.linkCount !== 1 || state.code.after?.linkCount !== 1) {
    return { pass: false, message: "code/link table cell lost link rendering when caret landed on a plain-text run" };
  }

  return {
    pass: true,
    message: "table cells keep their rich tokens rendered when the caret lands on plain text",
  };
}
