/**
 * Regression test: ATX headings parse and render correctly.
 *
 * Opens the stable regression fixture and verifies the Lezer syntax tree
 * contains ATXHeading nodes.
 */

/* global window */

import { openRegressionDocument, scrollToText, waitForRenderReady } from "../test-helpers.mjs";

export const name = "headings";

export async function run(page) {
  await openRegressionDocument(page);
  await waitForRenderReady(page);

  const tree = await page.evaluate(() => window.__cmDebug.treeString());

  const hasH1 = tree.includes("ATXHeading1");
  const hasH2 = tree.includes("ATXHeading2");

  if (!hasH1 && !hasH2) {
    return { pass: false, message: "No ATXHeading1 or ATXHeading2 found in syntax tree" };
  }

  await scrollToText(page, "# Display Math");

  // Verify heading decorations exist in the DOM (line decorations with heading classes)
  const headingCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(
      '.cf-heading-line-1, .cf-heading-line-2, .cf-heading-line-3, [data-section-number]',
    ).length;
  });

  if (headingCount === 0) {
    return {
      pass: false,
      message: "Heading nodes exist in tree but no heading line decorations or section numbers are visible",
    };
  }

  const sectionNumbers = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return Array.from(editor.querySelectorAll("[data-section-number]"))
      .map((el) => el.getAttribute("data-section-number"))
      .filter(Boolean);
  });

  return {
    pass: true,
    message: `${headingCount} visible heading decorations (${sectionNumbers.join(", ")})`,
  };
}
