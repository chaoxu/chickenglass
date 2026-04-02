/**
 * Regression test: mode switching (rich -> source -> rich).
 *
 * Switches to source mode, verifies decorations are removed (e.g. block headers
 * become raw fenced div syntax), then switches back to rich mode and verifies
 * decorations are restored.
 */

/* global window */

import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "mode-switch";

export async function run(page) {
  await openRegressionDocument(page);
  await new Promise((r) => setTimeout(r, 800));

  // Ensure we start in rich mode
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 500));

  // Count rendered widgets in rich mode
  const richHeaderCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-block-header").length;
  });

  const richKatexCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex").length;
  });

  // Switch to source mode
  await page.evaluate(() => window.__app.setMode("source"));
  await new Promise((r) => setTimeout(r, 500));

  // In source mode, rendered widgets should be gone
  const sourceHeaderCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-block-header").length;
  });

  const sourceKatexCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex").length;
  });

  // Source mode should have no rendered block headers
  if (sourceHeaderCount > 0) {
    // Switch back before returning
    await page.evaluate(() => window.__app.setMode("rich"));
    await new Promise((r) => setTimeout(r, 300));
    return {
      pass: false,
      message: `Source mode still has ${sourceHeaderCount} .cf-block-header elements (expected 0)`,
    };
  }

  // Source mode should have no KaTeX renders
  if (sourceKatexCount > 0) {
    await page.evaluate(() => window.__app.setMode("rich"));
    await new Promise((r) => setTimeout(r, 300));
    return {
      pass: false,
      message: `Source mode still has ${sourceKatexCount} .katex elements (expected 0)`,
    };
  }

  // Switch back to rich mode
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 500));

  // Verify widgets are restored
  const restoredHeaderCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-block-header").length;
  });

  const restoredKatexCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".katex").length;
  });

  if (richHeaderCount > 0 && restoredHeaderCount === 0) {
    return {
      pass: false,
      message: "Block headers did not restore after switching back to rich mode",
    };
  }

  if (richKatexCount > 0 && restoredKatexCount === 0) {
    return {
      pass: false,
      message: "KaTeX renders did not restore after switching back to rich mode",
    };
  }

  return {
    pass: true,
    message: `Rich: ${richHeaderCount} headers, ${richKatexCount} katex. Source: cleared. Restored: ${restoredHeaderCount} headers, ${restoredKatexCount} katex`,
  };
}
