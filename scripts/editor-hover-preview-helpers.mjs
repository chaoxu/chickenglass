/* global window, document, HTMLElement, MouseEvent, HTMLButtonElement */

import { settleEditorLayout } from "./editor-wait-helpers.mjs";
import { waitForRenderReady } from "./editor-render-helpers.mjs";

const HOVER_PREVIEW_SHOW_TIMEOUT_MS = 5_000;
const HOVER_PREVIEW_HIDE_TIMEOUT_MS = 2_000;
const HOVER_PREVIEW_POLL_MS = 100;
const HOVER_PREVIEW_STATE_TIMEOUT_MS = 5_000;

export async function showHoverPreview(page, selector) {
  const found = await page.evaluate((css) => {
    const target = document.querySelector(css);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    target.dispatchEvent(new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    return true;
  }, selector);

  if (!found) {
    throw new Error(`Failed to find hover target for selector ${JSON.stringify(selector)}`);
  }

  await page.waitForFunction(
    () => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return tooltip instanceof HTMLElement &&
        tooltip.style.display !== "none" &&
        tooltip.childElementCount > 0;
    },
    null,
    { timeout: HOVER_PREVIEW_SHOW_TIMEOUT_MS, polling: HOVER_PREVIEW_POLL_MS },
  );
  await waitForRenderReady(page, { selector: ".cf-hover-preview-tooltip", frameCount: 1 });
}

/**
 * Hide the hover-preview tooltip by dispatching mouseout on the same selector.
 *
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
export async function hideHoverPreview(page, selector) {
  await page.evaluate((css) => {
    const target = document.querySelector(css);
    if (!(target instanceof HTMLElement)) {
      return;
    }
    target.dispatchEvent(new MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      view: window,
      relatedTarget: null,
    }));
  }, selector);

  await page.waitForFunction(
    () => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return !(tooltip instanceof HTMLElement) || tooltip.style.display === "none";
    },
    null,
    { timeout: HOVER_PREVIEW_HIDE_TIMEOUT_MS, polling: HOVER_PREVIEW_POLL_MS },
  );
  await settleEditorLayout(page);
}

/**
 * Read the currently visible hover-preview tooltip state.
 *
 * @param {import("playwright").Page} page
 */
export async function readHoverPreviewState(page) {
  return page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip");
    if (!(tooltip instanceof HTMLElement) || tooltip.style.display === "none") {
      return null;
    }
    return {
      text: tooltip.textContent ?? "",
      hasTable: Boolean(tooltip.querySelector(".cf-block-table table")),
      hasCaption: Boolean(tooltip.querySelector(".cf-block-caption")),
      captionText: tooltip.querySelector(".cf-block-caption")?.textContent ?? "",
      imageSrc: tooltip.querySelector(".cf-block-figure img")?.getAttribute("src") ?? null,
    };
  });
}

/**
 * Poll until the visible hover-preview tooltip satisfies `predicate`.
 *
 * @param {import("playwright").Page} page
 * @param {(state: {
 *   text: string,
 *   hasTable: boolean,
 *   hasCaption: boolean,
 *   captionText: string,
 *   imageSrc: string | null,
 * }) => boolean} predicate
 * @param {number} [timeoutMs=5000]
 */
export async function waitForHoverPreviewState(page, predicate, timeoutMs = HOVER_PREVIEW_STATE_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tooltip = await readHoverPreviewState(page);
    if (tooltip && predicate(tooltip)) {
      return tooltip;
    }
    await settleEditorLayout(page, { frameCount: 1, delayMs: 200 });
  }
  return readHoverPreviewState(page);
}
