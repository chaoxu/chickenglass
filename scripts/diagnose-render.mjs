#!/usr/bin/env node
/**
 * Deeper diagnostic for the CM6 + Lexical math rendering issue.
 *
 * Compares the same source LaTeX rendered in both surfaces, prints the full
 * KaTeX HTML for the FIRST inline math node and the FIRST display math node
 * in each mode. Any visible-rendering regression should show up as a diff.
 */

import process from "node:process";
import { openBrowserSession, closeBrowserSession } from "./devx-browser-session.mjs";
import {
  switchToMode,
  openFile,
  waitForRenderReady,
  waitForSemanticReady,
} from "./editor-test-helpers.mjs";

const FIXTURE = "index.md";

async function captureMathSamples(page, modeLabel, rootSelector) {
  return page.evaluate(({ selector, mode }) => {
    const root = document.querySelector(selector);
    if (!root) return { mode, found: false };
    const allKatex = Array.from(root.querySelectorAll(".katex"));
    const inlineKatex = allKatex.filter((el) => !el.classList.contains("katex-display") && !el.closest(".katex-display"));
    const displayKatex = Array.from(root.querySelectorAll(".katex-display .katex, .katex.katex-display"));
    const sampleInline = inlineKatex[0];
    const sampleDisplay = displayKatex[0];
    return {
      mode,
      found: true,
      counts: {
        total: allKatex.length,
        inline: inlineKatex.length,
        display: displayKatex.length,
      },
      sampleInlineHtml: sampleInline?.outerHTML ?? null,
      sampleDisplayHtml: sampleDisplay?.outerHTML ?? null,
      anyKatexError: root.querySelectorAll(".katex-error").length,
    };
  }, { selector: rootSelector, mode: modeLabel });
}

async function main() {
  const session = await openBrowserSession([], { autoStart: true });
  try {
    await openFile(session.page, FIXTURE);
    await waitForSemanticReady(session.page, { timeoutMs: 10_000 });

    await switchToMode(session.page, "cm6-rich");
    await waitForRenderReady(session.page, { timeoutMs: 10_000 });
    const cm6 = await captureMathSamples(session.page, "cm6-rich", ".cm-content");

    await switchToMode(session.page, "lexical");
    await waitForRenderReady(session.page, { timeoutMs: 10_000 });
    const lexical = await captureMathSamples(session.page, "lexical", "[contenteditable='true']");

    console.log(JSON.stringify({ cm6, lexical }, null, 2));
  } finally {
    await closeBrowserSession(session);
  }
}

main().catch((err) => {
  console.error("diagnose-render failed:", err);
  process.exit(1);
});
