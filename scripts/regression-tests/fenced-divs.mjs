/**
 * Regression test: fenced div blocks (theorem, proof, definition) render correctly.
 *
 * Verifies that FencedDiv nodes exist in the Lezer tree and that block header
 * widgets are present in the DOM.
 */

/* global window */

import {
  getFenceState,
  getTreeDivs,
  openRegressionDocument,
  scrollToText,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "fenced-divs";

export async function run(page) {
  await openRegressionDocument(page);
  await waitForRenderReady(page);

  // Check Lezer tree for FencedDiv nodes
  const treeDivs = await getTreeDivs(page);

  if (!Array.isArray(treeDivs) || treeDivs.length === 0) {
    return { pass: false, message: "No FencedDiv nodes found in syntax tree" };
  }

  await scrollToText(page, "Fundamental Theorem");

  // Check DOM for rendered block header widgets
  const headerCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-block-header").length;
  });

  if (headerCount === 0) {
    return {
      pass: false,
      message: `Found ${treeDivs.length} FencedDiv nodes but no .cf-block-header elements in DOM`,
    };
  }

  // Verify closing fences are hidden (zero height)
  const fences = await getFenceState(page);
  const visibleCloseFences = Array.isArray(fences)
    ? fences.filter((f) => f.visible === true)
    : [];

  // In rich mode, closing fences should be hidden
  const mode = await page.evaluate(() => window.__app.getMode());
  if (mode === "rich" && visibleCloseFences.length > 0) {
    return {
      pass: false,
      message: `${visibleCloseFences.length} closing fences are visible in rich mode (should be hidden)`,
    };
  }

  const numberedHeaders = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return Array.from(editor.querySelectorAll(".cf-block-header"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter((text) => /(?:Theorem|Lemma|Definition|Corollary|Problem)\s+\d+/.test(text));
  });

  if (numberedHeaders.length === 0) {
    return {
      pass: false,
      message: "Block headers are visible but none show counter text like 'Theorem 1'",
    };
  }

  return { pass: true, message: numberedHeaders.slice(0, 4).join("; ") };
}
