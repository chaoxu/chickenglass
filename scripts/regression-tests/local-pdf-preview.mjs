/**
 * Regression test: local PDF image previews in the public demo project.
 *
 * Ensures the `index.md` showcase PDF figure resolves past the temporary
 * loading placeholder and renders as a canvas-backed image widget.
 */

import {
  openRegressionDocument,
  scrollToText,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "local-pdf-preview";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await scrollToText(page, "Local PDF figure");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const status = await page.evaluate(async () => {
    const wrappers = Array.from(
      window.__cmView.dom.querySelectorAll(".cf-image-wrapper, .cf-image-error"),
    ).map((el) => ({
      className: el.className,
      text: el.textContent ?? "",
      ariaLabel:
        el.querySelector("canvas, img")?.getAttribute("aria-label")
        ?? el.getAttribute("aria-label")
        ?? "",
      hasCanvas: Boolean(el.querySelector("canvas")),
    }));

    const target = wrappers.find((entry) =>
      entry.text.includes("Generated showcase figure rendered from a local PDF asset")
      || entry.ariaLabel.includes("Generated showcase figure rendered from a local PDF asset"),
    );

    return {
      target,
      wrappers,
    };
  });

  if (!status.target) {
    return {
      pass: false,
      message: "missing generated PDF showcase figure widget",
    };
  }

  if (status.target.className.includes("cf-image-loading")) {
    return {
      pass: false,
      message: "PDF showcase figure is still loading",
    };
  }

  if (!status.target.hasCanvas) {
    return {
      pass: false,
      message: "PDF showcase figure did not render to canvas",
    };
  }

  return {
    pass: true,
    message: "local PDF showcase figure rendered as canvas",
  };
}
