/**
 * Regression test: CM6 rich renders unordered-list source markers as bullet
 * glyphs, including inside fenced divs.
 */

import {
  openEditorScenario,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "cm6-bullet-list-glyphs";

const DOC = [
  "- top one",
  "- top two",
  "",
  "::: {.proof}",
  "intro.",
  "",
  "- inside one",
  "- inside two",
  ":::",
  "",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "cm6-bullet-list-glyphs.md",
    files: {
      "cm6-bullet-list-glyphs.md": DOC,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });
  await waitForRenderReady(page, {
    selector: ".cf-list-bullet",
    frameCount: 3,
    delayMs: 64,
  });

  const state = await page.evaluate(() => {
    const bullets = [...document.querySelectorAll(".cf-list-bullet")].map((el) => ({
      text: el.textContent ?? "",
      lineText: el.closest(".cm-line")?.textContent ?? "",
    }));
    return {
      bullets,
      literalDashBullets: bullets.filter((item) => item.text === "-"),
      proofLine: [...document.querySelectorAll(".cm-line")]
        .map((line) => line.textContent ?? "")
        .find((text) => text.includes("inside two")) ?? "",
    };
  });

  if (state.bullets.length !== 4) {
    return { pass: false, message: `expected 4 rendered bullets, got ${JSON.stringify(state)}` };
  }
  if (state.literalDashBullets.length > 0) {
    return { pass: false, message: `bullet marker still renders as dash: ${JSON.stringify(state)}` };
  }
  if (!state.bullets.every((item) => item.text === "•")) {
    return { pass: false, message: `bullet markers are not bullet glyphs: ${JSON.stringify(state)}` };
  }
  if (!state.proofLine.includes("• inside two")) {
    return { pass: false, message: `fenced-div list did not render bullet glyph: ${JSON.stringify(state)}` };
  }

  return {
    pass: true,
    message: "CM6 rich renders top-level and fenced-div bullets as glyphs",
  };
}
