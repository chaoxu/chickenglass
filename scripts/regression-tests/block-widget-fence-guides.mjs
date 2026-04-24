/**
 * Regression test: block widgets inside an active fenced div keep the same
 * fence-guide lane as ordinary theorem body lines.
 *
 * This prevents display math, standalone images, and rendered tables from
 * visually punching holes in the active theorem/proof guide when the cursor is
 * inside the block.
 */

import { openFixtureDocument, waitForRenderReady } from "../test-helpers.mjs";

export const name = "block-widget-fence-guides";

const DIAGRAM_URL = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22120%22%20height%3D%2280%22%20viewBox%3D%220%200%20120%2080%22%3E%3Crect%20width%3D%22120%22%20height%3D%2280%22%20fill%3D%22%23fca5a5%22/%3E%3C/svg%3E";

const DOC = [
  "::: {.theorem}",
  "Prelude",
  "$$",
  "x^2 + y^2 = z^2",
  "$$",
  "",
  `![diagram](${DIAGRAM_URL})`,
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  ":::",
].join("\n");

export async function run(page) {
  await openFixtureDocument(
    page,
    {
      virtualPath: "block-widget-fence-guides.md",
      displayPath: "fixture:block-widget-fence-guides.md",
      content: DOC,
    },
    { mode: "rich" },
  );
  await waitForRenderReady(page, { selector: ".cf-math-display" });

  const status = await page.evaluate(async () => {
    const view = window.__cmView;
    const doc = view.state.doc.toString();
    const cursorPos = doc.indexOf("Prelude");
    if (cursorPos < 0) {
      throw new Error("Prelude line not found");
    }

    view.focus();
    view.dispatch({ selection: { anchor: cursorPos + 1 }, scrollIntoView: false });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const hasGuide = (selector) => {
      const el = view.dom.querySelector(selector);
      if (!(el instanceof HTMLElement)) return false;
      return el.classList.contains("cf-fence-guide") && el.classList.contains("cf-fence-d1");
    };

    return {
      math: hasGuide(".cf-math-display"),
      image: hasGuide(".cf-image-wrapper"),
      table: hasGuide(".cf-table-widget"),
    };
  });

  const failures = Object.entries(status)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (failures.length > 0) {
    return {
      pass: false,
      message: `missing fence guide on ${failures.join(", ")}`,
    };
  }

  return {
    pass: true,
    message: "math, image, and table widgets inherit theorem fence guides",
  };
}
