/**
 * Regression test: opening index.md from another document must keep rich math
 * rendering alive after the document switch completes.
 */

import {
  getRenderState,
  openFile,
  openRegressionDocument,
  scrollToText,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "index-open-rich-render";

export async function run(page) {
  await openRegressionDocument(page, "showcase/chicken.md");
  await openFile(page, "index.md");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });
  await scrollToText(page, "Inline math:");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });

  const status = await page.evaluate(async () => {
    const inView = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const visibleInlineMath = Array.from(
      document.querySelectorAll(".cf-math-inline"),
    ).filter(inView).length;
    const visibleDisplayMath = Array.from(
      document.querySelectorAll(".cf-math-display"),
    ).filter(inView).length;
    const visibleRawInlineMathLine = Array.from(
      document.querySelectorAll(".cm-line"),
    )
      .filter(inView)
      .find((el) => (el.textContent ?? "").includes("Inline math:"));

    return {
      visibleInlineMath,
      visibleDisplayMath,
      visibleRawInlineMathLine: visibleRawInlineMathLine?.textContent ?? null,
    };
  });

  if (status.visibleInlineMath < 2) {
    return {
      pass: false,
      message: `inline math missing after index reopen (${status.visibleInlineMath} visible widgets)`,
    };
  }

  if (status.visibleDisplayMath < 1) {
    return {
      pass: false,
      message: `display math missing after index reopen (${status.visibleDisplayMath} visible widgets)`,
    };
  }

  await scrollToText(page, "Code Blocks");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });

  const codeBlockStatus = await page.evaluate(() => {
    const inView = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const visibleHeaders = Array.from(
      document.querySelectorAll(".cf-codeblock-header"),
    ).filter(inView);
    const visibleLanguages = Array.from(
      document.querySelectorAll(".cf-codeblock-language"),
    ).filter(inView);
    const visibleRawFence = Array.from(document.querySelectorAll(".cm-line"))
      .filter(inView)
      .find((el) => {
        const text = el.innerText ?? "";
        return text.includes("```haskell") || text.includes("```ts");
      });

    return {
      visibleHeaders: visibleHeaders.length,
      visibleLanguages: visibleLanguages.length,
      visibleRawFenceText: visibleRawFence?.innerText ?? null,
    };
  });

  if (codeBlockStatus.visibleHeaders < 1 || codeBlockStatus.visibleLanguages < 1) {
    return {
      pass: false,
      message:
        `code blocks missing after index reopen (` +
        `${codeBlockStatus.visibleHeaders} headers, ` +
        `${codeBlockStatus.visibleLanguages} languages)`,
    };
  }

  if (codeBlockStatus.visibleRawFenceText) {
    return {
      pass: false,
      message:
        `code block opener stayed visibly raw after index reopen: ` +
        `${codeBlockStatus.visibleRawFenceText}`,
    };
  }

  await scrollToText(page, "Tables");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });

  const tableStatus = await page.evaluate(() => {
    const inView = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const visibleTables = Array.from(
      document.querySelectorAll(".cf-table-widget"),
    ).filter(inView);
    const visibleRawTableLine = Array.from(document.querySelectorAll(".cm-line"))
      .filter(inView)
      .find((el) => (el.innerText ?? "").includes("| Algorithm | Time | Space |"));

    return {
      visibleTables: visibleTables.length,
      visibleRawTableLine: visibleRawTableLine?.innerText ?? null,
    };
  });

  if (tableStatus.visibleTables < 1) {
    return {
      pass: false,
      message: `table widget missing after index reopen (${tableStatus.visibleTables} visible)`,
    };
  }

  if (tableStatus.visibleRawTableLine) {
    return {
      pass: false,
      message: `table markdown stayed visibly raw after index reopen: ${tableStatus.visibleRawTableLine}`,
    };
  }

  await scrollToText(page, "Links and Images");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });
  await page.waitForFunction(
    () => {
      const inView = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      };
      return Array.from(document.querySelectorAll(".cf-image-wrapper")).some(inView);
    },
    { timeout: 5000 },
  ).catch(() => {});

  const imageStatus = await page.evaluate(() => {
    const inView = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const visibleImages = Array.from(
      document.querySelectorAll(".cf-image-wrapper"),
    ).filter(inView);
    const visibleRawImageLine = Array.from(document.querySelectorAll(".cm-line"))
      .filter(inView)
      .find((el) =>
        (el.innerText ?? "").includes("![Local hover-preview figure]")
      );

    return {
      visibleImages: visibleImages.length,
      visibleRawImageLine: visibleRawImageLine?.innerText ?? null,
    };
  });

  if (imageStatus.visibleImages < 1) {
    return {
      pass: false,
      message: `image preview missing after index reopen (${imageStatus.visibleImages} visible)`,
    };
  }

  if (imageStatus.visibleRawImageLine) {
    return {
      pass: false,
      message: `image markdown stayed visibly raw after index reopen: ${imageStatus.visibleRawImageLine}`,
    };
  }

  await scrollToText(page, "Block Hover Preview Coverage");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });

  const theoremRenderState = await getRenderState(page);
  const theoremStatus = await page.evaluate((renderState) => {
    const openerLine = Array.from(document.querySelectorAll(".cm-line")).find((el) =>
      (el.textContent ?? "").includes("Hover Preview Stress Test")
    );
    const rawLine = Array.from(document.querySelectorAll(".cm-line")).find((el) =>
      (el.innerText ?? "").includes("{#thm:hover-preview .theorem}")
    );
    const openerHtml = openerLine?.innerHTML ?? "";
    return {
      rawVisible: Boolean(rawLine),
      openerHasRenderedHeader: openerHtml.includes("cf-block-header-rendered"),
      openerHasRawAttrs: openerHtml.includes("{#thm:hover-preview .theorem}"),
      openerText: openerLine?.textContent ?? null,
      visibleRawFencedOpeners: renderState?.visibleRawFencedOpeners ?? [],
    };
  }, theoremRenderState);

  if (theoremStatus.rawVisible) {
    return {
      pass: false,
      message: "theorem opener attributes are still visibly raw after index reopen",
    };
  }

  if (!theoremStatus.openerHasRenderedHeader || theoremStatus.openerHasRawAttrs) {
    return {
      pass: false,
      message:
        "theorem opener did not mount its rendered header before first interaction",
    };
  }

  if (
    theoremStatus.visibleRawFencedOpeners.some((entry) =>
      String(entry.text ?? "").includes("thm:hover-preview .theorem")
    )
  ) {
    return {
      pass: false,
      message:
        "renderState still reports the theorem fenced opener as visibly raw before interaction",
    };
  }

  await scrollToText(page, "Blockquote with Math");
  await settleEditorLayout(page, { frameCount: 4, delayMs: 80 });

  const blockquoteRenderState = await getRenderState(page);
  const blockquoteStatus = {
    visibleRawFencedOpeners: blockquoteRenderState?.visibleRawFencedOpeners ?? [],
  };

  if (
    blockquoteStatus.visibleRawFencedOpeners.some((entry) =>
      String(entry.text ?? "").includes("::: Blockquote")
    )
  ) {
    return {
      pass: false,
      message:
        "renderState still reports the blockquote fenced opener as visibly raw before interaction",
    };
  }

  return {
    pass: true,
    message:
      `index reopen kept block surfaces rendered ` +
      `(${status.visibleInlineMath} inline, ${status.visibleDisplayMath} display, ` +
      `${codeBlockStatus.visibleHeaders} code headers, ${tableStatus.visibleTables} tables, ` +
      `${imageStatus.visibleImages} images)`,
  };
}
