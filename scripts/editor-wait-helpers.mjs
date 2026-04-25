/* global window, document, performance, requestAnimationFrame, setTimeout, clearTimeout */
/**
 * Pure wait/poll helpers for browser scripts.
 *
 * No imports from editor-test-helpers; this module is the foundation other
 * helpers build on. Layout/scroll readiness helpers (waitForRenderReady,
 * waitForScrollReady) live in editor-test-helpers because they reach into
 * editor-state and DOM helpers that depend on the broader test surface.
 */
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

/**
 * Wait for one or more browser animation frames in the app page.
 *
 * @param {import("playwright").Page} page
 * @param {number} [frameCount=2]
 */
export async function waitForAnimationFrames(page, frameCount = 2) {
  await page.evaluate(async (nextFrameCount) => {
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
    for (let frame = 0; frame < nextFrameCount; frame += 1) {
      await waitForFrame();
    }
  }, Math.max(1, frameCount));
}

/**
 * Settle the editor layout: wait for `frameCount` animation frames and
 * optionally an additional `delayMs` cooldown. Used as the default "let
 * layout breathe" knob across the test surface.
 *
 * @param {import("playwright").Page} page
 * @param {{ frameCount?: number, delayMs?: number }} [options]
 */
export async function settleEditorLayout(page, options = {}) {
  const frameCount = Math.max(1, options.frameCount ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 32);
  await waitForAnimationFrames(page, frameCount);
  if (delayMs > 0) {
    await page.evaluate(async (nextDelayMs) => {
      await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
    }, delayMs);
  }
}

/**
 * Wait until the active editor bridge and semantic snapshot are available and
 * stable across animation frames.
 *
 * Lexical/source modes may not expose CM6 semantic debug data; in those modes
 * the canonical document text and app mode still provide the readiness key.
 *
 * @param {import("playwright").Page} page
 * @param {{ timeoutMs?: number, stableFrames?: number }} [options]
 */
export async function waitForSemanticReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
  const stableFrames = Math.max(1, options.stableFrames ?? 2);
  return page.evaluate(async ({ nextTimeoutMs, nextStableFrames }) => {
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

    const startedAt = performance.now();
    let lastKey = "";
    let stableCount = 0;
    while (performance.now() - startedAt < nextTimeoutMs) {
      const mode = window.__app?.getMode?.() ?? null;
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString?.();
      const semantics = window.__cmDebug?.semantics?.() ?? null;
      const revision = typeof semantics?.revision === "number" ? semantics.revision : null;
      if (typeof doc === "string" && mode) {
        const key = `${mode}:${doc.length}:${revision ?? "none"}`;
        if (key === lastKey) {
          stableCount += 1;
        } else {
          lastKey = key;
          stableCount = 0;
        }
        if (stableCount >= nextStableFrames) {
          return {
            docLength: doc.length,
            mode,
            revision,
          };
        }
      }
      await waitForFrame();
    }
    throw new Error(`Timed out waiting ${nextTimeoutMs}ms for semantic readiness.`);
  }, {
    nextStableFrames: stableFrames,
    nextTimeoutMs: timeoutMs,
  });
}

/**
 * Wait until the canonical document/mode/semantic revision has stayed unchanged
 * for a quiet window. Use this when a test is guarding against delayed sync
 * overwriting a recent edit.
 *
 * @param {import("playwright").Page} page
 * @param {{ pollIntervalMs?: number, quietMs?: number, timeoutMs?: number }} [options]
 */
export async function waitForDocumentStable(page, options = {}) {
  return page.evaluate(async ({ pollIntervalMs, quietMs, timeoutMs }) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const hashText = (text) => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const readKey = () => {
      const mode = window.__app?.getMode?.() ?? null;
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString?.();
      const revision = window.__cmDebug?.semantics?.()?.revision ?? null;
      return typeof doc === "string" && mode
        ? `${mode}:${doc.length}:${revision}:${hashText(doc)}`
        : null;
    };

    const startedAt = performance.now();
    let stableSince = performance.now();
    let previousKey = readKey();
    while (performance.now() - startedAt < timeoutMs) {
      const currentKey = readKey();
      if (!currentKey) {
        stableSince = performance.now();
        previousKey = currentKey;
        await sleepInPage(pollIntervalMs);
        continue;
      }
      if (currentKey !== previousKey) {
        previousKey = currentKey;
        stableSince = performance.now();
      }
      if (performance.now() - stableSince >= quietMs) {
        return true;
      }
      await sleepInPage(pollIntervalMs);
    }
    throw new Error(`Timed out waiting ${timeoutMs}ms for ${quietMs}ms of stable document state.`);
  }, {
    pollIntervalMs: Math.max(
      1,
      options.pollIntervalMs ?? DEFAULT_RUNTIME_BUDGET_PROFILE.pollIntervalMs,
    ),
    quietMs: Math.max(0, options.quietMs ?? 250),
    timeoutMs: Math.max(1, options.timeoutMs ?? 5_000),
  });
}

/**
 * Wait for a sidebar panel to be active and laid out.
 *
 * @param {import("playwright").Page} page
 * @param {"files" | "outline" | "diagnostics" | "runtime"} panel
 * @param {{ pollIntervalMs?: number, timeoutMs?: number }} [options]
 */
export async function waitForSidebarReady(page, panel, options = {}) {
  await page.waitForFunction(
    (nextPanel) => {
      const sidebar = window.__app?.getSidebarState?.();
      return sidebar && !sidebar.collapsed && sidebar.tab === nextPanel;
    },
    panel,
    {
      timeout: options.timeoutMs ?? 5_000,
      polling: options.pollIntervalMs ?? DEFAULT_RUNTIME_BUDGET_PROFILE.pollIntervalMs,
    },
  );
  await settleEditorLayout(page, { frameCount: 2 });
}
