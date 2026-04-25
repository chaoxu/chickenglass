/* global window, document, performance, requestAnimationFrame, setTimeout, clearTimeout */

import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import {
  settleEditorLayout,
  waitForSemanticReady,
} from "./editor-wait-helpers.mjs";

export const DEFAULT_RENDER_READY_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;

export async function waitForRenderReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_RENDER_READY_TIMEOUT_MS);
  await waitForSemanticReady(page, { timeoutMs });
  if (options.selector) {
    await page.waitForFunction(
      ({ selector, minCount }) =>
        document.querySelectorAll(selector).length >= minCount,
      {
        selector: options.selector,
        minCount: Math.max(1, options.minCount ?? 1),
      },
      { timeout: timeoutMs, polling: 100 },
    );
  }
  await settleEditorLayout(page, {
    delayMs: options.delayMs ?? 0,
    frameCount: options.frameCount ?? 2,
  });
}

/**
 * Wait until the CM6 scroller dimensions stop changing across animation
 * frames. Use this before scroll measurements so measured latency is not
 * mixed with fixture-open layout churn.
 *
 * @param {import("playwright").Page} page
 * @param {{ timeoutMs?: number, stableFrames?: number }} [options]
 */
export async function waitForScrollReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_RENDER_READY_TIMEOUT_MS);
  await waitForRenderReady(page, { timeoutMs, frameCount: 2 });
  await page.evaluate(async ({ nextTimeoutMs, nextStableFrames }) => {
    const waitForFrame = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timeoutId = setTimeout(finish, 50);
        requestAnimationFrame(() => {
          clearTimeout(timeoutId);
          finish();
        });
      });
    const readKey = () => {
      const view = window.__cmView;
      if (!view?.scrollDOM) {
        return null;
      }
      const scroller = view.scrollDOM;
      return [
        Math.round(scroller.scrollHeight),
        Math.round(scroller.clientHeight),
        Math.round(Math.max(0, scroller.scrollHeight - scroller.clientHeight)),
        Math.round(scroller.scrollTop),
        view.viewport?.from ?? -1,
        view.viewport?.to ?? -1,
      ].join(":");
    };

    const startedAt = performance.now();
    let previousKey = readKey();
    let stableCount = 0;
    while (performance.now() - startedAt < nextTimeoutMs) {
      await waitForFrame();
      const currentKey = readKey();
      if (!currentKey) {
        previousKey = currentKey;
        stableCount = 0;
        continue;
      }
      if (currentKey === previousKey) {
        stableCount += 1;
        if (stableCount >= nextStableFrames) {
          return true;
        }
      } else {
        previousKey = currentKey;
        stableCount = 0;
      }
    }
    throw new Error(`Timed out waiting ${nextTimeoutMs}ms for stable scroll layout.`);
  }, {
    nextStableFrames: Math.max(1, options.stableFrames ?? 2),
    nextTimeoutMs: timeoutMs,
  });
}
