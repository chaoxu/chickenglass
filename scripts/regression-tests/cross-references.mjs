/**
 * Regression test: cross-reference rendering.
 *
 * Verifies that `[@...]` references in the document are rendered as
 * `.cf-crossref` widgets in the DOM.
 */

/* global window */

import { openRegressionDocument, scrollToText } from "../test-helpers.mjs";

export const name = "cross-references";

export async function run(page) {
  const openedPath = await openRegressionDocument(page);
  await new Promise((r) => setTimeout(r, 800));

  // Ensure rich mode for rendered widgets
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

  await scrollToText(page, "# Cross-References");

  // Check for crossref widgets in DOM
  const crossrefCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-crossref").length;
  });

  // Check for unresolved crossrefs (should ideally be zero, but not a failure)
  const unresolvedCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-crossref-unresolved").length;
  });

  // Check if the document actually contains crossref syntax
  const hasCrossrefSyntax = await page.evaluate(() => {
    const doc = window.__cmView.state.doc.toString();
    // Match [@...] patterns (cross-references, citations)
    return /\[@[^\]]+\]/.test(doc);
  });

  if (hasCrossrefSyntax && crossrefCount === 0) {
    return {
      pass: false,
      message: "Document contains [@...] syntax but no .cf-crossref elements rendered",
    };
  }

  if (!hasCrossrefSyntax) {
    // Document doesn't have crossrefs — test is inconclusive but not a failure
    return {
      pass: true,
      message: `No crossref syntax found in ${openedPath} (test skipped — add [@...] to exercise)`,
    };
  }

  await scrollToText(page, "# Cross-References and Citations");
  await page.waitForFunction(
    () => window.__cmView.dom.querySelectorAll(".cf-citation").length > 0,
    { timeout: 5000 },
  ).catch(() => {});

  const citationCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-citation").length;
  });

  if (citationCount === 0) {
    return {
      pass: false,
      message: "Document contains citation syntax but no .cf-citation elements are visible",
    };
  }

  return {
    pass: true,
    message: `${crossrefCount} crossrefs rendered (${unresolvedCount} unresolved), ${citationCount} citations visible`,
  };
}
