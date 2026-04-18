import { setSelection } from "../test-helpers.mjs";

export const name = "block-insert-focus";

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

async function expandAtEnd(page, path, text) {
  await openScratch(page, path, text);
  await setSelection(page, text.length);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
}

export async function run(page) {
  await expandAtEnd(page, "scratch-insert-display-math.md", "$$");
  const displayMath = await page.evaluate(() => {
    const source = document.querySelector(
      ".cf-lexical-display-math.is-editing .cf-lexical-structure-source-editor--math[contenteditable='true']",
    );
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
      activeInsideMath: Boolean(document.activeElement?.closest(".cf-lexical-display-math")),
      offset,
      sourceText: source?.textContent ?? "",
    };
  });
  if (
    !displayMath.activeInsideMath
    || !displayMath.sourceText.startsWith("$$")
    || !displayMath.sourceText.endsWith("$$")
    || displayMath.offset === null
    || displayMath.offset < 2
    || displayMath.offset > displayMath.sourceText.length - 2
  ) {
    return {
      pass: false,
      message: `display-math markdown expansion did not focus the equation body: ${JSON.stringify(displayMath)}`,
    };
  }

  await expandAtEnd(page, "scratch-insert-include.md", "::: {.include}");
  const includePath = await page.evaluate(() => ({
    activeInsideInclude: Boolean(document.activeElement?.closest(".cf-lexical-include-shell")),
    includeEditors: document.querySelectorAll(
      ".cf-lexical-include-shell .cf-lexical-structure-source-editor--include[contenteditable='true']",
    ).length,
  }));
  if (!includePath.activeInsideInclude || includePath.includeEditors !== 1) {
    return {
      pass: false,
      message: `include markdown expansion did not focus the include path surface: ${JSON.stringify(includePath)}`,
    };
  }

  await openScratch(page, "scratch-insert-table.md", "");
  await page.evaluate(() => window.__editor.focus());
  await page.keyboard.type("| A | B |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("| --- | --- |");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const tableEntry = await page.evaluate(() => {
    const selection = window.getSelection();
    const anchorElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    return {
      activeInsideBodyCell: Boolean(anchorElement?.closest("td[data-coflat-block-keyboard-entry='primary']")),
      primaryCells: document.querySelectorAll(
        ".cf-lexical-table-block td[data-coflat-block-keyboard-entry='primary']",
      ).length,
    };
  });
  if (!tableEntry.activeInsideBodyCell || tableEntry.primaryCells === 0) {
    return {
      pass: false,
      message: `table markdown expansion did not focus a primary body cell: ${JSON.stringify(tableEntry)}`,
    };
  }

  return {
    pass: true,
    message: "markdown-expanded blocks focus declared display math, include, and table entry surfaces",
  };
}
