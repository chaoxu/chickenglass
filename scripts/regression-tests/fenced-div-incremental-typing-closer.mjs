/**
 * Regression test: typing a fenced div body and closer incrementally must leave
 * the closing fence attached to the FencedDiv.
 */

import {
  getFenceState,
  getTreeString,
  openEditorScenario,
  settleEditorLayout,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "fenced-div-incremental-typing-closer";

const DOC = [
  "::: {.proof}",
  "By induction on $n$.",
  "",
  "- **Base case.** $n = 1$ is trivial.",
  "- **Inductive step.** Assume [@eq:squares]. Then",
  "  $$",
  "  \\sum_{k=1}^{n+1} k^2 = \\frac{n(n+1)(2n+1)}{6}.",
  "  $$",
  "",
  ":::",
  "",
  "See [@thm:squares].",
  "",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "fenced-div-incremental-typing-closer.md",
    files: {
      "fenced-div-incremental-typing-closer.md": "",
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });
  await waitForRenderReady(page, { selector: ".cm-content" });

  await page.evaluate(async (doc) => {
    for (const ch of doc) {
      globalThis.__editor.insertText(ch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, DOC);
  await settleEditorLayout(page, { frameCount: 6, delayMs: 64 });

  const [tree, fences, visibleLines] = await Promise.all([
    getTreeString(page),
    getFenceState(page),
    page.evaluate(() =>
      [...globalThis.__cmView.dom.querySelectorAll(".cm-line")]
        .filter((line) => getComputedStyle(line).height !== "0px")
        .map((line) => line.textContent ?? "")
    ),
  ]);
  const state = {
    tree,
    fences,
    visibleLines,
  };

  if (!/FencedDiv\([^)]*FencedDivFence[^)]*\)/s.test(state.tree)) {
    return {
      pass: false,
      message: `FencedDiv tree does not contain a closing fence: ${state.tree}`,
    };
  }
  if (state.visibleLines.some((text) => text.trim() === ":::")) {
    return {
      pass: false,
      message: `closing fence leaked into visible lines: ${JSON.stringify(state)}`,
    };
  }
  if (!state.visibleLines.some((text) => text.includes("Proof"))) {
    return {
      pass: false,
      message: `inline proof header is missing: ${JSON.stringify(state)}`,
    };
  }

  return {
    pass: true,
    message: "incrementally typed fenced-div closer remains attached",
  };
}
