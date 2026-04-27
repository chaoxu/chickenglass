/* global window, document, performance, HTMLButtonElement, HTMLElement, MouseEvent */

import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import {
  settleEditorLayout,
  waitForAnimationFrames,
  waitForSemanticReady,
  waitForSidebarReady,
} from "./editor-wait-helpers.mjs";
import { waitForRenderReady } from "./editor-render-helpers.mjs";

const APP_BRIDGE_TIMEOUT_MS = DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;
const APP_MODE_SWITCH_TIMEOUT_MS = 2_000;
const APP_SEARCH_TIMEOUT_MS = 5_000;
const AUTOCOMPLETE_TIMEOUT_MS = 5_000;
const APP_BRIDGE_POLL_MS = 25;
const APP_BRIDGE_WAIT_POLL_MS = 50;

function selectorForEditorMode(mode) {
  if (mode === "lexical") {
    return ".cf-doc-flow--lexical";
  }
  if (mode === "source") {
    return ".cm-editor.cf-source-mode .cm-content";
  }
  return ".cm-editor:not(.cf-source-mode) .cf-doc-flow--cm6";
}

export async function focusEditorEnd(page) {
  await page.evaluate(() => {
    if (window.__editor) {
      const doc = window.__editor.getDoc();
      window.__editor.focus();
      window.__editor.setSelection(doc.length);
      return;
    }
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await settleEditorLayout(page);
}

/**
 * Read the full raw editor document text.
 *
 * @param {import("playwright").Page} page
 */
export async function readEditorText(page) {
  return page.evaluate(() =>
    window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString()
  );
}

export async function formatSelection(page, detail) {
  const handled = await page.evaluate((nextDetail) => (
    window.__editor?.formatSelection?.(nextDetail) ?? false
  ), detail);
  if (!handled) {
    throw new Error(`formatSelection was not handled: ${JSON.stringify(detail)}`);
  }
  await waitForSemanticReady(page);
}

/**
 * Save the current document through the app debug bridge.
 *
 * @param {import("playwright").Page} page
 */
export async function saveCurrentFile(page) {
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await waitForSemanticReady(page);
}

/**
 * Discard the currently open document without prompting.
 *
 * @param {import("playwright").Page} page
 */
export async function discardCurrentFile(page) {
  const discarded = await page.evaluate(async () => {
    const app = window.__app;
    if (!app?.closeFile) {
      return false;
    }
    if (!app.getCurrentDocument?.()) {
      return true;
    }
    const closed = await app.closeFile({ discard: true });
    if (closed) {
      return true;
    }
    return !app.getCurrentDocument?.();
  });
  await waitForAnimationFrames(page, 2);
  return discarded;
}

export async function switchToMode(page, mode) {
  const normalizedMode = mode === "Rich" || mode === "CM6 Rich" || mode === "rich"
    ? "cm6-rich"
    : mode === "Lexical"
      ? "lexical"
      : mode === "Source"
        ? "source"
        : mode;
  const changedViaApp = await page.evaluate(async (payload) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const bridgeStart = performance.now();
    while (performance.now() - bridgeStart < payload.nextBridgeTimeoutMs) {
      if (window.__app?.setMode && window.__app?.getMode) {
        break;
      }
      await sleepInPage(payload.bridgePollMs);
    }
    if (!window.__app?.setMode || !window.__app?.getMode) {
      return null;
    }
    window.__app.setMode(payload.nextMode);
    const start = performance.now();
    while (performance.now() - start < payload.nextModeSwitchTimeoutMs) {
      const currentMode = window.__app?.getMode?.();
      if (currentMode === payload.nextMode) {
        return currentMode;
      }
      await sleepInPage(payload.bridgePollMs);
    }
    return window.__app?.getMode?.() ?? null;
  }, {
    nextMode: normalizedMode,
    nextBridgeTimeoutMs: APP_BRIDGE_TIMEOUT_MS,
    nextModeSwitchTimeoutMs: APP_MODE_SWITCH_TIMEOUT_MS,
    bridgePollMs: APP_BRIDGE_WAIT_POLL_MS,
  });

  if (changedViaApp === null) {
    const diagnostics = await page.evaluate(() => ({
      bodyText: document.body?.innerText?.slice(0, 200) ?? "",
      globals: {
        __app: Boolean(window.__app),
        __cfDebug: Boolean(window.__cfDebug),
        __cmView: Boolean(window.__cmView),
        __editor: Boolean(window.__editor),
      },
      title: document.title,
      url: location.href,
    })).catch((error) => ({
      evaluateError: error instanceof Error ? error.message : String(error),
    }));
    throw new Error(
      `Failed to switch editor mode to ${normalizedMode}; app debug bridge unavailable: ${JSON.stringify(diagnostics)}`,
    );
  }

  if (changedViaApp !== normalizedMode) {
    throw new Error(`Failed to switch editor mode to ${normalizedMode}; current mode is ${changedViaApp}.`);
  }
  await waitForRenderReady(page, {
    selector: selectorForEditorMode(normalizedMode),
    timeoutMs: APP_BRIDGE_TIMEOUT_MS,
  });
}

/**
 * Open a sidebar panel through the app debug bridge and wait for a settled frame.
 *
 * @param {import("playwright").Page} page
 * @param {"files" | "outline" | "diagnostics" | "runtime"} panel
 */
export async function showSidebarPanel(page, panel) {
  const changedViaApp = await page.evaluate(async (payload) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForAnimationFrames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bridgeStart = performance.now();
    while (performance.now() - bridgeStart < payload.nextBridgeTimeoutMs) {
      if (window.__app?.showSidebarPanel && window.__app?.getSidebarState) {
        break;
      }
      await sleepInPage(payload.bridgePollMs);
    }
    if (!window.__app?.showSidebarPanel || !window.__app?.getSidebarState) {
      return null;
    }
    window.__app.showSidebarPanel(payload.nextPanel);
    const settleStart = performance.now();
    while (performance.now() - settleStart < payload.nextModeSwitchTimeoutMs) {
      const sidebar = window.__app.getSidebarState();
      if (!sidebar.collapsed && sidebar.tab === payload.nextPanel) {
        await waitForAnimationFrames();
        return payload.nextPanel;
      }
      await sleepInPage(payload.pollIntervalMs);
    }
    return window.__app.getSidebarState().tab;
  }, {
    nextPanel: panel,
    nextBridgeTimeoutMs: APP_BRIDGE_TIMEOUT_MS,
    nextModeSwitchTimeoutMs: APP_MODE_SWITCH_TIMEOUT_MS,
    bridgePollMs: APP_BRIDGE_WAIT_POLL_MS,
    pollIntervalMs: APP_BRIDGE_POLL_MS,
  });

  if (changedViaApp === null) {
    throw new Error(`Failed to show sidebar panel ${panel}; app debug bridge unavailable.`);
  }
  if (changedViaApp !== panel) {
    throw new Error(`Failed to show sidebar panel ${panel}; current tab is ${changedViaApp}.`);
  }
  await waitForSidebarReady(page, panel);
}

/**
 * Open the app-level search panel and wait for its input to appear.
 *
 * @param {import("playwright").Page} page
 */
export async function openAppSearch(page) {
  await page.evaluate(() => {
    window.__app.setSearchOpen(true);
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector('[role="dialog"] input')),
    { timeout: APP_SEARCH_TIMEOUT_MS },
  );
  await settleEditorLayout(page);
}

/**
 * Click the first visible search-dialog result button containing `needle`.
 *
 * @param {import("playwright").Page} page
 * @param {string} needle
 */
export async function clickSearchDialogResult(page, needle) {
  const clicked = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((candidate) =>
      (candidate.textContent ?? "").includes(text));
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }
    button.click();
    return true;
  }, needle);

  if (!clicked) {
    throw new Error(`failed to click search result containing ${JSON.stringify(needle)}`);
  }
}
/**
 * Close the app-level search panel if it is open.
 *
 * @param {import("playwright").Page} page
 */
export async function closeAppSearch(page) {
  const isOpen = await page.evaluate(
    () => Boolean(document.querySelector('[role="dialog"] input')),
  );
  if (!isOpen) {
    return;
  }
  await page.evaluate(() => {
    window.__app.setSearchOpen(false);
  });
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"] input'),
    { timeout: APP_SEARCH_TIMEOUT_MS },
  );
  await settleEditorLayout(page);
}

/**
 * Wait for the CM6 autocomplete popup to render at least one option.
 *
 * @param {import("playwright").Page} page
 */
export async function waitForAutocomplete(page) {
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-tooltip-autocomplete li").length > 0,
    undefined,
    { timeout: AUTOCOMPLETE_TIMEOUT_MS },
  );
  await settleEditorLayout(page);
}

/**
 * Read the visible CM6 autocomplete labels.
 *
 * @param {import("playwright").Page} page
 */
export async function readAutocompleteOptions(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".cm-tooltip-autocomplete li")]
      .map((item) => item.textContent?.trim() ?? "")
      .filter(Boolean),
  );
}

/**
 * Pick a CM6 autocomplete option by substring match.
 *
 * @param {import("playwright").Page} page
 * @param {string} needle
 */
export async function pickAutocompleteOption(page, needle) {
  const picked = await page.evaluate((matchText) => {
    const option = [...document.querySelectorAll(".cm-tooltip-autocomplete li")]
      .find((item) => (item.textContent ?? "").includes(matchText));
    if (!(option instanceof HTMLElement)) {
      return false;
    }
    for (const type of ["mousedown", "mouseup", "click"]) {
      option.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
    return true;
  }, needle);
  if (!picked) {
    throw new Error(`Failed to pick autocomplete option matching ${JSON.stringify(needle)}`);
  }
  await waitForSemanticReady(page);
}

/**
 * Insert text into the active CM6 selection using a typed-input userEvent.
 *
 * @param {import("playwright").Page} page
 * @param {string} text
 */
export async function insertEditorText(page, text) {
  await page.evaluate((insertText) => {
    const view = window.__cmView;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      userEvent: "input.type",
    });
  }, text);
  await waitForSemanticReady(page);
}

/**
 * Replace the full editor document text and place the cursor at the end.
 *
 * @param {import("playwright").Page} page
 * @param {string} text
 */
export async function replaceEditorText(page, text) {
  await page.evaluate((nextText) => {
    const view = window.__cmView;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextText },
      selection: { anchor: nextText.length },
      userEvent: "input.type",
    });
  }, text);
  await waitForSemanticReady(page);
}
