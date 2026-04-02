/**
 * Regression test: code block rendering and syntax highlighting.
 *
 * Verifies that FencedCode nodes exist in the syntax tree and that code blocks
 * have rendered with the codeblock header/body decorations.
 */

/* global window */

import { openRegressionDocument, scrollToText } from "../test-helpers.mjs";

export const name = "code-blocks";

export async function run(page) {
  await openRegressionDocument(page);
  await new Promise((r) => setTimeout(r, 800));

  // Check for FencedCode in syntax tree
  const tree = await page.evaluate(() => window.__cmDebug.treeString());
  const hasFencedCode = tree.includes("FencedCode");

  if (!hasFencedCode) {
    return { pass: false, message: "No FencedCode node found in syntax tree" };
  }

  await scrollToText(page, "function isPrime");

  // Check for codeblock header decorations
  const headerCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-codeblock-header").length;
  });

  // Check for codeblock body decorations
  const bodyCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-codeblock-body").length;
  });

  if (headerCount === 0 && bodyCount === 0) {
    return {
      pass: false,
      message: "FencedCode exists in tree but no .cf-codeblock-header or .cf-codeblock-body in DOM",
    };
  }

  return {
    pass: true,
    message: `${headerCount} code block headers, ${bodyCount} body lines rendered`,
  };
}
