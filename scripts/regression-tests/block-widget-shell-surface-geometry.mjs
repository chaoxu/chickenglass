/**
 * Regression test: active shell geometry must include block widget surfaces.
 *
 * Display math, standalone images, and table widgets hide their source lines,
 * so the shell-surface overlay has to measure the rendered widgets directly.
 */

import { openFixtureDocument, sleep } from "../test-helpers.mjs";

export const name = "block-widget-shell-surface-geometry";

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
      virtualPath: "block-widget-shell-surface-geometry.md",
      displayPath: "fixture:block-widget-shell-surface-geometry.md",
      content: DOC,
    },
    { mode: "rich" },
  );
  await sleep(500);

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

    const snapshot = window.__cmDebug.geometry();
    const surface = snapshot.surfaces[0];
    if (!surface?.rect) {
      return { error: "missing active shell surface rect" };
    }

    const surfaceRect = surface.rect;

    const encloses = (selector) => {
      const widget = view.dom.querySelector(selector);
      if (!(widget instanceof HTMLElement)) {
        return { found: false, contains: false };
      }
      const rect = widget.getBoundingClientRect();
      const contains = (
        surfaceRect.top <= rect.top + 1 &&
        surfaceRect.bottom >= rect.bottom - 1 &&
        surfaceRect.left <= rect.left + 1 &&
        surfaceRect.right >= rect.right - 1
      );
      return { found: true, contains, rect };
    };

    return {
      math: encloses(".cf-math-display"),
      image: encloses(".cf-image-wrapper"),
      table: encloses(".cf-table-widget"),
      surfaceRect,
    };
  });

  if (status.error) {
    return {
      pass: false,
      message: status.error,
    };
  }

  const failures = ["math", "image", "table"].filter((key) => {
    const entry = status[key];
    return !entry?.found || !entry?.contains;
  });

  if (failures.length > 0) {
    return {
      pass: false,
      message: `shell surface missed ${failures.join(", ")}`,
    };
  }

  return {
    pass: true,
    message: "shell surface encloses math, image, and table block widgets",
  };
}
