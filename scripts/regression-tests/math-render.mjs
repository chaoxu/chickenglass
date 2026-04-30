/**
 * Regression test: KaTeX math rendering works.
 *
 * Verifies that `.katex` elements exist in the regression document DOM,
 * meaning inline and/or display math has been rendered by KaTeX.
 */

/* global window */

import {
  openRegressionDocument,
  settleEditorLayout,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "math-render";

const MODE_SELECTORS = {
  "cm6-rich": {
    displayMath: ".cf-math-display",
    displayMathLabel: ".cf-math-display-number",
    inlineMath: ".cf-math-inline",
  },
};

async function collectMathStats(page, mode) {
  await switchToMode(page, mode);
  await waitForRenderReady(page, { selector: ".katex", minCount: 4 });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  return page.evaluate(({ selectors }) => {
    const annotations = [...document.querySelectorAll(".katex annotation[encoding='application/x-tex']")]
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const labelTexts = [...document.querySelectorAll(selectors.displayMathLabel)]
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      annotations,
      displayCount: document.querySelectorAll(selectors.displayMath).length,
      errorCount: document.querySelectorAll(".katex-error").length,
      inlineCount: document.querySelectorAll(selectors.inlineMath).length,
      katexCount: document.querySelectorAll(".katex").length,
      labelTexts,
      texts: [...document.querySelectorAll(".katex")]
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    };
  }, { selectors: MODE_SELECTORS[mode] });
}

function normalizedAnnotationSet(stats) {
  return new Set(stats.annotations.map((annotation) => annotation.replace(/\s+/g, " ").trim()));
}

function renderedTextIncludes(stats, expected) {
  return stats.texts.some((text) => text.includes(expected));
}

export async function run(page) {
  await openRegressionDocument(page);

  const cm6 = await collectMathStats(page, "cm6-rich");

  if (cm6.katexCount === 0) {
    return { pass: false, message: "CM6 rich: no .katex elements found in DOM" };
  }
  if (cm6.errorCount > 0) {
    return {
      pass: false,
      message: `CM6 rich: found ${cm6.katexCount} .katex elements but ${cm6.errorCount} .katex-error nodes`,
    };
  }
  if (cm6.inlineCount === 0 || cm6.displayCount === 0) {
    return {
      pass: false,
      message: `CM6 rich: expected inline and display math, got inline=${cm6.inlineCount}, display=${cm6.displayCount}`,
    };
  }

  if (!renderedTextIncludes(cm6, "x2")) {
    return {
      pass: false,
      message: "CM6 rich: missing rendered inline math text for x^2",
    };
  }

  const cm6Annotations = normalizedAnnotationSet(cm6);
  for (const expected of ["\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}"]) {
    if (!cm6Annotations.has(expected)) {
      return {
        pass: false,
        message: `missing expected KaTeX annotation "${expected}"`,
      };
    }
  }

  return {
    pass: true,
    message: `CM6 ${cm6.inlineCount} inline/${cm6.displayCount} display math rendered`,
  };
}
