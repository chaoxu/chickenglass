/**
 * Regression test: CM6 rich prose editing inside fenced divs must not reveal
 * block syntax or hide inline headers.
 */

import {
  openEditorScenario,
  setCursor,
  settleEditorLayout,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "fenced-div-body-stays-rendered";

const DOC = [
  "::: {.proof}",
  "By induction on $n$.",
  ":::",
  "",
  "::: {.theorem}",
  "Every finite tree has a leaf.",
  ":::",
  "",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "fenced-div-body-stays-rendered.md",
    files: {
      "fenced-div-body-stays-rendered.md": DOC,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });
  await waitForRenderReady(page, {
    selector: ".cf-block-header",
    frameCount: 3,
    delayMs: 64,
  });

  await setCursor(page, 2, 3);
  const activatedFromBody = await page.evaluate(() =>
    window.__cmDebug.activateStructureAtCursor()
  );
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const state = await page.evaluate((activated) => ({
    activatedFromBody: activated,
    structure: window.__cmDebug.structure(),
    lines: [...window.__cmView.dom.querySelectorAll(".cm-line")].map((line) => ({
      text: line.textContent ?? "",
      hidden: getComputedStyle(line).height === "0px",
      classes: [...line.classList],
    })),
    fences: window.__cmDebug.fences(),
  }), activatedFromBody);

  const visibleText = state.lines
    .filter((line) => !line.hidden)
    .map((line) => line.text)
    .join("\n");
  const visibleClosingFences = Array.isArray(state.fences)
    ? state.fences.filter((fence) => fence.visible)
    : [];

  if (state.activatedFromBody) {
    return {
      pass: false,
      message: `body prose activated fenced structure edit: ${JSON.stringify(state.structure)}`,
    };
  }
  if (state.structure !== null) {
    return {
      pass: false,
      message: `body prose left structure edit active: ${JSON.stringify(state.structure)}`,
    };
  }
  if (!visibleText.includes("Proof")) {
    return {
      pass: false,
      message: `inline proof header disappeared: ${JSON.stringify(state.lines)}`,
    };
  }
  if (visibleText.includes(":::")) {
    return {
      pass: false,
      message: `fenced-div syntax became visible while editing body: ${JSON.stringify(state.lines)}`,
    };
  }
  if (visibleClosingFences.length > 0) {
    return {
      pass: false,
      message: `closing fences are visible: ${JSON.stringify(visibleClosingFences)}`,
    };
  }

  return {
    pass: true,
    message: "fenced-div body editing keeps headers rendered and fences hidden",
  };
}
