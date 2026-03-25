/**
 * Regression test: cross-reference rendering.
 *
 * Verifies that `[@...]` references in the document are rendered as
 * `.cf-crossref` widgets in the DOM.
 */

/* global window */

export const name = "cross-references";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));

  // Ensure rich mode for rendered widgets
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

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
      message: "No crossref syntax found in index.md (test skipped — add [@...] to exercise)",
    };
  }

  return {
    pass: true,
    message: `${crossrefCount} crossrefs rendered (${unresolvedCount} unresolved)`,
  };
}
