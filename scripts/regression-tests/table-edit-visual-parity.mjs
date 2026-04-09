import {
  openRegressionDocument,
  scrollToText,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "table-edit-visual-parity";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await scrollToText(page, "Rich table for edit/display parity");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const target = await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll(".cf-table-widget td")).find((el) =>
      el.textContent?.includes("Bold") && el.textContent?.includes("x2"),
    );
    if (!(cell instanceof HTMLElement)) {
      return null;
    }

    const strong = cell.querySelector("strong");
    const textNode = Array.from(cell.childNodes).find((node) =>
      node.nodeType === Node.TEXT_NODE && node.textContent?.includes(" and "),
    );
    if (!(strong instanceof HTMLElement) || !(textNode instanceof Text)) {
      return null;
    }

    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });

  if (!target) {
    return {
      pass: false,
      message: "failed to locate rich parity table cell target",
    };
  }

  await page.mouse.click(target.x, target.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const state = await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll(".cf-table-widget td")).find((el) =>
      el.classList.contains("cf-table-cell-editing"),
    );
    if (!(cell instanceof HTMLElement)) {
      return null;
    }
    const line = cell.querySelector(".cm-line");
    return {
      hasBold: Boolean(line?.querySelector(".cf-bold")),
      hasRenderedMath: Boolean(line?.querySelector(".cf-math-inline")),
      delimiterCount: line?.querySelectorAll(".cf-source-delimiter").length ?? -1,
      text: line?.textContent ?? "",
    };
  });

  if (!state) {
    return {
      pass: false,
      message: "table cell did not enter inline edit mode",
    };
  }

  if (!state.hasBold || !state.hasRenderedMath || state.delimiterCount !== 0) {
    return {
      pass: false,
      message: `unexpected active cell rendering (bold=${state.hasBold}, math=${state.hasRenderedMath}, delimiters=${state.delimiterCount})`,
    };
  }

  return {
    pass: true,
    message: "trusted table-cell click keeps the active cell visually rendered",
  };
}
