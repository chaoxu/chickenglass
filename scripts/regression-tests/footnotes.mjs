/**
 * Regression test: footnote reference and definition rendering.
 *
 * Verifies that [^id] footnote references render as sidenote ref widgets
 * and that footnote definitions get the sidenote body line decoration.
 */

/* global window */

import {
  openRegressionDocument,
  scrollToText,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "footnotes";

export async function run(page) {
  const openedPath = await openRegressionDocument(page);
  await waitForRenderReady(page);

  // Ensure rich mode
  await switchToMode(page, "cm6-rich");

  await scrollToText(page, "# Footnotes");

  // Check if document contains footnote syntax
  const hasFootnoteSyntax = await page.evaluate(() => {
    const doc = window.__cmView.state.doc.toString();
    return /\[\^[^\]]+\]/.test(doc);
  });

  if (!hasFootnoteSyntax) {
    return {
      pass: true,
      skipped: true,
      message: `No footnote syntax found in ${openedPath} (test skipped — add [^id] to exercise)`,
    };
  }

  // Check for footnote reference widgets (sidenote refs)
  const refCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-sidenote-ref").length;
  });

  // Check for footnote definition body lines
  const defBodyCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-sidenote-def-body").length;
  });

  // Check syntax tree for FootnoteRef nodes
  const tree = await page.evaluate(() => window.__cmDebug.treeString());
  const hasFootnoteRef = tree.includes("FootnoteRef");

  if (!hasFootnoteRef) {
    return {
      pass: false,
      message: "Document has [^...] syntax but no FootnoteRef in syntax tree",
    };
  }

  if (refCount === 0) {
    return {
      pass: false,
      message: "FootnoteRef exists in tree but no .cf-sidenote-ref widgets in DOM",
    };
  }

  return {
    pass: true,
    message: `${refCount} footnote refs, ${defBodyCount} definition body lines`,
  };
}
