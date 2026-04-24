/**
 * Regression test: KaTeX math rendering works.
 *
 * Verifies that `.katex` elements exist in the regression document DOM,
 * meaning inline and/or display math has been rendered by KaTeX.
 */

/* global window */

import { openRegressionDocument, waitForRenderReady } from "../test-helpers.mjs";

export const name = "math-render";

export async function run(page) {
  await openRegressionDocument(page);
  await waitForRenderReady(page, { selector: ".katex" });

  // Check for rendered KaTeX elements
  const katexCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex").length;
  });

  if (katexCount === 0) {
    return { pass: false, message: "No .katex elements found in DOM — math not rendering" };
  }

  // Verify no KaTeX errors (red error text from bad LaTeX)
  const errorCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex-error").length;
  });

  if (errorCount > 0) {
    return {
      pass: false,
      message: `Found ${katexCount} .katex elements but ${errorCount} have .katex-error`,
    };
  }

  // Check for display math (block-level equations)
  const displayCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex-display").length;
  });

  return {
    pass: true,
    message: `${katexCount} inline + ${displayCount} display math elements rendered`,
  };
}
