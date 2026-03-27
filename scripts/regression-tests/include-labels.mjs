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

  const beforeCycle = await page.evaluate(() => {
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

  if (beforeCycle.sourceMapRegions === 0) {
    return {
      pass: false,
      message: "Expanded index.md has no source-map regions to drive include labels",
    };
  }

  if (beforeCycle.labels.length === 0 || beforeCycle.regions === 0) {
    return {
      pass: false,
      message: "Include source-map regions exist but no include labels/regions are visible before mode cycling",
    };
  }

  await page.evaluate(() => window.__app.setMode("source"));
  await new Promise((r) => setTimeout(r, 300));

  const sourceMode = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return {
      labels: editor.querySelectorAll(".cf-include-label").length,
      regions: editor.querySelectorAll(".cf-include-region").length,
    };
  });

  if (sourceMode.labels !== 0 || sourceMode.regions !== 0) {
    return {
      pass: false,
      message: "Include labels should be hidden in source mode",
    };
  }

  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));
  await scrollToText(page, "# Introduction");

  const afterCycle = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return {
      sourceMapRegions: window.__cfSourceMap?.regions.length ?? 0,
      labels: Array.from(editor.querySelectorAll(".cf-include-label"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean),
      regions: editor.querySelectorAll(".cf-include-region").length,
    };
  });

  if (afterCycle.sourceMapRegions !== beforeCycle.sourceMapRegions) {
    return {
      pass: false,
      message: "Source-map regions changed across mode cycling",
    };
  }

  if (afterCycle.labels.length === 0 || afterCycle.regions === 0) {
    return {
      pass: false,
      message: "Include labels/regions did not return after switching back to rich mode",
    };
  }

  return {
    pass: true,
    message: `${afterCycle.labels.join(", ")} (${beforeCycle.activeLabels.join(", ") || "no active label"})`,
  };
}
