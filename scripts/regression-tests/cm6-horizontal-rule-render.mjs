/**
 * Regression test: CM6 rich renders FORMAT.md horizontal rules as <hr>.
 */

import {
  openEditorScenario,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "cm6-horizontal-rule-render";

const DOC = [
  "before paragraph",
  "",
  "---",
  "",
  "after paragraph",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "cm6-horizontal-rule-render.md",
    files: {
      "cm6-horizontal-rule-render.md": DOC,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });
  await waitForRenderReady(page, {
    selector: ".cf-hr",
    frameCount: 3,
    delayMs: 64,
  });

  const state = await page.evaluate(() => ({
    hrCount: document.querySelector(".cm-content")?.querySelectorAll("hr.cf-hr").length ?? 0,
    lines: [...document.querySelectorAll(".cm-line")].map((line) => ({
      text: line.textContent ?? "",
      tag: line.getAttribute("data-tag-name"),
    })),
  }));

  if (state.hrCount !== 1) {
    return {
      pass: false,
      message: `expected one rendered hr, got ${JSON.stringify(state)}`,
    };
  }

  if (!state.lines.some((line) => line.tag === "hr")) {
    return {
      pass: false,
      message: `horizontal rule line is missing hr tag metadata: ${JSON.stringify(state)}`,
    };
  }

  return {
    pass: true,
    message: "CM6 rich renders horizontal rule as <hr>",
  };
}
