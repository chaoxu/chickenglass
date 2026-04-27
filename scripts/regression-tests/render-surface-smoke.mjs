/**
 * Regression test: both editor surfaces render real content + math.
 *
 * Catches the "everything looks fine in unit tests but the actual app shows
 * a blank editor" failure mode (#1473-style runtime gaps). For each mode
 * (cm6-rich, lexical) the test asserts:
 *
 *   - editor surface present and non-empty (height > 0, visible lines > 0)
 *   - at least one .katex node rendered (math reachable)
 *   - zero .katex-error nodes (no LaTeX failed to render)
 *   - first display .katex carries BOTH the .katex-mathml semantic branch
 *     and the .katex-html visual branch (so copy-as-MathML, screen readers,
 *     and MathJax-aware tools all keep working)
 *
 * Inline CM6 math intentionally renders with the "html" output only
 * (see src/render/inline-render.ts) — that trade-off is documented and
 * not flagged here. Lexical inline math keeps both branches.
 *
 * Switches the editor back to cm6-rich at the end so subsequent
 * regression tests that rely on `__cmView` (math-render, local-pdf-preview,
 * nested-fenced-vertical-motion) inherit a sane mode.
 */

/* global document */

import {
  openRegressionDocument,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "render-surface-smoke";

const MODES = [
  { mode: "cm6-rich", rootSelector: ".cm-content" },
  { mode: "lexical", rootSelector: "[contenteditable='true']" },
];

async function inspectMode(page, modeSpec) {
  return page.evaluate((spec) => {
    const root = document.querySelector(spec.rootSelector);
    if (!root) return { rootMissing: true };
    const lines = Array.from(root.querySelectorAll(".cm-line, p, h1, h2, h3, li"));
    const visibleLineCount = lines.filter((el) => (el.textContent ?? "").trim().length > 0).length;
    const allKatex = Array.from(root.querySelectorAll(".katex"));
    const displayKatex = allKatex.filter((el) =>
      el.classList.contains("katex-display") || el.closest(".katex-display"),
    );
    const inlineKatex = allKatex.filter((el) => !displayKatex.includes(el));
    const firstDisplay = displayKatex[0];
    return {
      rootMissing: false,
      rootHeight: root.getBoundingClientRect().height,
      visibleLineCount,
      katexCount: allKatex.length,
      inlineKatexCount: inlineKatex.length,
      displayKatexCount: displayKatex.length,
      katexErrorCount: root.querySelectorAll(".katex-error").length,
      firstDisplayHasMathml: Boolean(firstDisplay?.querySelector(".katex-mathml")),
      firstDisplayHasHtml: Boolean(firstDisplay?.querySelector(".katex-html")),
      firstDisplayOuter: firstDisplay?.outerHTML?.slice(0, 200) ?? null,
    };
  }, modeSpec);
}

function checkMode(modeSpec, snap) {
  if (snap.rootMissing) return `${modeSpec.mode}: editor root '${modeSpec.rootSelector}' not in DOM`;
  if (snap.rootHeight <= 0) return `${modeSpec.mode}: editor root has zero height`;
  if (snap.visibleLineCount < 1) return `${modeSpec.mode}: zero visible lines`;
  if (snap.katexCount === 0) return `${modeSpec.mode}: no .katex nodes rendered`;
  if (snap.katexErrorCount > 0) {
    return `${modeSpec.mode}: ${snap.katexErrorCount} .katex-error nodes (LaTeX failed to render)`;
  }
  if (snap.displayKatexCount > 0) {
    if (!snap.firstDisplayHasMathml) {
      return `${modeSpec.mode}: first display .katex missing .katex-mathml branch — output: ${snap.firstDisplayOuter}`;
    }
    if (!snap.firstDisplayHasHtml) {
      return `${modeSpec.mode}: first display .katex missing .katex-html branch — output: ${snap.firstDisplayOuter}`;
    }
  }
  return null;
}

export async function run(page) {
  await openRegressionDocument(page);
  await waitForRenderReady(page, { timeoutMs: 10_000 });

  const failures = [];
  const summary = [];

  for (const modeSpec of MODES) {
    await switchToMode(page, modeSpec.mode);
    await waitForRenderReady(page, { timeoutMs: 10_000 });
    const snap = await inspectMode(page, modeSpec);
    const failure = checkMode(modeSpec, snap);
    if (failure) {
      failures.push(failure);
    } else {
      summary.push(
        `${modeSpec.mode}: ${snap.visibleLineCount} lines, ${snap.inlineKatexCount} inline + ${snap.displayKatexCount} display katex`,
      );
    }
  }

  // Restore CM6 mode so downstream tests that touch __cmView (math-render,
  // local-pdf-preview, nested-fenced-vertical-motion) don't crash on a
  // Lexical-mode session.
  await switchToMode(page, "cm6-rich");
  await waitForRenderReady(page, { timeoutMs: 10_000 });

  if (failures.length > 0) {
    return { pass: false, message: failures.join(" | ") };
  }
  return { pass: true, message: summary.join(" | ") };
}
