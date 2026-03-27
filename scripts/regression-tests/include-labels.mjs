/**
 * Regression test: expanded include regions still show filename labels.
 *
 * Verifies the runtime path where the document text has already been expanded
 * from include blocks and include metadata comes from the source-map state.
 */

/* global window */

import { scrollToText } from "../test-helpers.mjs";

export const name = "include-labels";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

  await scrollToText(page, "# Introduction");

  const info = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return {
      sourceMapRegions: window.__cfSourceMap?.regions.length ?? 0,
      labels: Array.from(editor.querySelectorAll(".cf-include-label"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean),
      activeLabels: Array.from(editor.querySelectorAll(".cf-include-label-active"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean),
      regions: editor.querySelectorAll(".cf-include-region").length,
    };
  });

  if (info.sourceMapRegions === 0) {
    return {
      pass: false,
      message: "Expanded index.md has no source-map regions to drive include labels",
    };
  }

  if (info.labels.length === 0 || info.regions === 0) {
    return {
      pass: false,
      message: "Include source-map regions exist but no include labels/regions are visible",
    };
  }

  return {
    pass: true,
    message: `${info.labels.join(", ")} (${info.activeLabels.join(", ") || "no active label"})`,
  };
}
