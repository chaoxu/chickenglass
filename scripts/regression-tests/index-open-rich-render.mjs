/**
 * Regression test: opening index.md from another document must keep rich math
 * rendering alive after the async include-expansion rewrite lands.
 */

import {
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

  return {
    pass: true,
    message: `index reopen kept inline/display math rendered (${status.visibleInlineMath} inline, ${status.visibleDisplayMath} display)`,
  };
}
