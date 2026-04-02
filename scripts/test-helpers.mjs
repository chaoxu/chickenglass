/* global window */
/**
 * Playwright test helpers for CDP-based browser testing.
 *
 * Usage:
 *   import { connectEditor, openFile, getTreeDivs, checkFences, dump } from "./test-helpers.mjs";
 *
 *   const page = await connectEditor();
 *   await openFile(page, "test-features.md");
 *   console.log(await getTreeDivs(page));
 *   console.log(await checkFences(page, [73, 77, 88]));
 *   console.log(await dump(page));
 */

import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { chromium } from "playwright";
import { findFirstPage } from "./chrome-common.mjs";

const DEFAULT_PORT = 9322;
const MODE_LABELS = {
  rich: "Rich",
  source: "Source",
  read: "Read",
};

/** Promise-based sleep. */
export function sleep(ms) {
  return delay(ms);
}

/**
 * Connect to a running Chromium instance via CDP and return the page.
 * Requires `npm run chrome` running in another terminal.
 */
export async function connectEditor(port = DEFAULT_PORT) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  let page = await findFirstPage(browser);
  if (!page) {
    await sleep(1000);
    page = await findFirstPage(browser);
  }
  if (!page) throw new Error("No page found. Is Chrome running with npm run chrome?");
  page.setDefaultTimeout(10000);
  return page;
}

/**
 * Focus the editor and place the selection at the end of the document.
 *
 * @param {import("playwright").Page} page
 */
export async function focusEditorEnd(page) {
  await page.evaluate(() => {
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await sleep(100);
}

/**
 * Read the full raw editor document text.
 *
 * @param {import("playwright").Page} page
 */
export async function readEditorText(page) {
  return page.evaluate(() => window.__cmView.state.doc.toString());
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
  await sleep(150);
}

/**
 * Discard the currently open document without prompting.
 *
 * @param {import("playwright").Page} page
 */
export async function discardCurrentFile(page) {
  const discarded = await page.evaluate(async () => {
    if (!window.__app?.closeFile) {
      return false;
    }
    return window.__app.closeFile({ discard: true });
  });
  await sleep(150);
  return discarded;
}

/**
 * Open a file by path (e.g. "posts/2014-11-04-isotonic-....md").
 * Uses the app's real openFile function via window.__app.
 */
export async function openFile(page, path) {
  await page.evaluate((p) => window.__app.openFile(p), path);
  await sleep(500);
}

/**
 * Open a stable fixture for browser regression tests.
 *
 * Older regressions used whichever demo file happened to be the default open
 * document, which made the suite drift whenever demo content changed. Default
 * to the dedicated regression fixture instead.
 */
export async function openRegressionDocument(page, path = "cogirth/regression-suite.md") {
  await openFile(page, path);
  return path;
}

/**
 * Find the first line number whose raw text contains `needle`.
 */
export async function findLine(page, needle) {
  return page.evaluate((text) => {
    const doc = window.__cmView.state.doc;
    for (let line = 1; line <= doc.lines; line += 1) {
      if (doc.line(line).text.includes(text)) {
        return line;
      }
    }
    return -1;
  }, needle);
}

/**
 * Cycle the editor mode button until the requested mode is active.
 *
 * @param {import("playwright").Page} page
 * @param {"rich" | "source" | "read" | "Rich" | "Source" | "Read"} mode
 */
export async function switchToMode(page, mode) {
  const targetLabel = MODE_LABELS[mode] ?? mode;

  const changedViaApp = await page.evaluate((nextMode) => {
    if (!window.__app?.setMode || !window.__app?.getMode) {
      return false;
    }
    window.__app.setMode(nextMode);
    return true;
  }, mode);

  if (changedViaApp) {
    await page.waitForFunction(
      (expectedMode) => window.__app.getMode() === expectedMode,
      mode,
      { timeout: 5000 },
    );
    await sleep(200);
    return;
  }

  const modeButton = page.getByTestId("mode-button");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentLabel = (await modeButton.textContent())?.trim();
    if (currentLabel === targetLabel) return;
    await modeButton.click();
    await sleep(200);
  }

  const finalLabel = (await modeButton.textContent())?.trim();
  throw new Error(`Failed to switch editor mode to ${targetLabel}; current mode is ${finalLabel ?? "<unknown>"}.`);
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
    { timeout: 5000 },
  );
  await sleep(150);
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
    { timeout: 5000 },
  );
  await sleep(100);
}

/**
 * Wait for the CM6 autocomplete popup to render at least one option.
 *
 * @param {import("playwright").Page} page
 */
export async function waitForAutocomplete(page) {
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-tooltip-autocomplete li").length > 0,
    { timeout: 5000 },
  );
  await sleep(100);
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
  await sleep(100);
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
  await sleep(100);
}

/**
 * Run a block that mutates a fixture document, then restore the fixture in a
 * `finally` block so later browser regressions see pristine demo content.
 *
 * @param {import("playwright").Page} page
 * @param {{ path: string, content: string }} fixture
 * @param {() => Promise<unknown>} run
 */
export async function withRestoredFixture(page, fixture, run) {
  let result;
  let runError = null;

  try {
    result = await run();
  } catch (error) {
    runError = error;
  }

  try {
    await openFile(page, fixture.path);
    await switchToMode(page, "source");
    await replaceEditorText(page, fixture.content);
    await saveCurrentFile(page);
  } catch (restoreError) {
    if (runError instanceof Error) {
      throw new Error(
        `${runError.message}\nfixture restore failed for ${fixture.path}: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
    throw restoreError;
  }

  if (runError) {
    throw runError;
  }

  return result;
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
  await sleep(100);
}

/**
 * Trigger a hover-preview tooltip for a rendered reference/citation selector.
 *
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
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

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const visible = await page.evaluate(() => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return tooltip instanceof HTMLElement &&
        tooltip.style.display !== "none" &&
        tooltip.childElementCount > 0;
    });
    if (visible) {
      await sleep(100);
      return;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for hover preview for selector ${JSON.stringify(selector)}`);
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

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hidden = await page.evaluate(() => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return !(tooltip instanceof HTMLElement) || tooltip.style.display === "none";
    });
    if (hidden) {
      await sleep(100);
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out hiding hover preview for selector ${JSON.stringify(selector)}`);
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
export async function waitForHoverPreviewState(page, predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tooltip = await readHoverPreviewState(page);
    if (tooltip && predicate(tooltip)) {
      return tooltip;
    }
    await sleep(200);
  }
  return readHoverPreviewState(page);
}
/**
 * Return FencedDiv nodes from the current Lezer syntax tree.
 * Requires `__cmDebug` to be wired up (see use-editor.ts).
 */
export async function getTreeDivs(page) {
  return page.evaluate(() => window.__cmDebug.tree());
}

/**
 * Check visibility of closing fence lines.
 * Returns an array of { line, visible, height, classes } objects.
 *
 * @param {import("playwright").Page} page
 * @param {number[]} lineNumbers - line numbers to check (e.g. [73, 77, 88])
 */
export async function checkFences(page, lineNumbers) {
  return page.evaluate((lines) => {
    return lines.map((ln) => {
      const info = window.__cmDebug.line(ln);
      if (!info) return { line: ln, visible: null, height: "no-el", classes: [], found: false };
      const { height, hidden, classes } = info;
      return { line: ln, visible: !hidden, height, classes, found: true };
    });
  }, lineNumbers);
}

/**
 * Return a full debug snapshot: tree divs, fence status, cursor position.
 */
export async function dump(page) {
  return page.evaluate(() => window.__cmDebug.dump());
}

/**
 * Place cursor at a specific line and column, with focus.
 */
export async function setCursor(page, line, col = 0) {
  await page.evaluate(
    ({ line, col }) => {
      const view = window.__cmView;
      view.focus();
      const lineObj = view.state.doc.line(line);
      view.dispatch({ selection: { anchor: lineObj.from + col } });
    },
    { line, col },
  );
  await sleep(200);
}

/**
 * Scroll the editor to show a specific line near the top.
 */
export async function scrollTo(page, line) {
  await page.evaluate((ln) => {
    const view = window.__cmView;
    const lineObj = view.state.doc.line(ln);
    view.dispatch({
      selection: { anchor: lineObj.from },
      scrollIntoView: true,
    });
  }, line);
  await sleep(400);
}

/**
 * Scroll the editor so the first line containing `needle` is visible.
 */
export async function scrollToText(page, needle) {
  const line = await findLine(page, needle);
  if (line < 0) {
    throw new Error(`Missing line containing "${needle}"`);
  }
  await scrollTo(page, line);
  return line;
}

function issueMatches(text, patterns) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));
}

/**
 * Capture runtime issues emitted during a browser scenario.
 *
 * Collects `console.error(...)` messages and uncaught page errors while the
 * callback runs, then returns both the callback result and any captured issues.
 *
 * @param {import("playwright").Page} page
 * @param {() => Promise<unknown>} run
 * @param {{
 *   ignoreConsole?: Array<string | RegExp>,
 *   ignorePageErrors?: Array<string | RegExp>,
 * }} [options]
 */
export async function withRuntimeIssueCapture(page, run, options = {}) {
  const issues = [];
  const ignoreConsole = options.ignoreConsole ?? [];
  const ignorePageErrors = options.ignorePageErrors ?? [];

  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (issueMatches(text, ignoreConsole)) return;
    issues.push({ source: "console", text });
  };

  const onPageError = (error) => {
    const text = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    if (issueMatches(text, ignorePageErrors)) return;
    issues.push({ source: "pageerror", text });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const value = await run();
    await sleep(100);
    return { value, issues };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

/**
 * Summarize a list of captured runtime issues for regression-test output.
 *
 * @param {Array<{ source: string, text: string }>} issues
 * @param {number} [limit=3]
 */
export function formatRuntimeIssues(issues, limit = 3) {
  if (issues.length === 0) return "none";
  return issues
    .slice(0, limit)
    .map((issue) => `[${issue.source}] ${issue.text}`)
    .join(" | ");
}

/**
 * Collect a generic editor/app health snapshot after a scenario step.
 *
 * The goal is to catch session-level breakage: invalid selection bounds,
 * missing debug bridge globals, duplicate transient UI surfaces, or malformed
 * semantic revision info after real user flows.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   maxVisibleDialogs?: number,
 *   maxVisibleHoverPreviews?: number,
 *   maxAutocompleteTooltips?: number,
 * }} [options]
 */
async function collectEditorHealth(page, options = {}) {
  const {
    maxVisibleDialogs = 0,
    maxVisibleHoverPreviews = 1,
    maxAutocompleteTooltips = 1,
  } = options;

  return page.evaluate((limits) => {
    const issues = [];
    const modeLabels = new Set(["rich", "source", "read"]);

    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((el) => isVisible(el)).length;

    if (!window.__app) issues.push("missing window.__app");
    if (!window.__cmView) issues.push("missing window.__cmView");
    if (!window.__cmDebug) issues.push("missing window.__cmDebug");
    if (!window.__cfDebug) issues.push("missing window.__cfDebug");

    const view = window.__cmView;
    const mode = window.__app?.getMode?.() ?? null;
    const docLength = view?.state?.doc?.length ?? -1;
    const selection = view?.state?.selection?.main
      ? {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
        }
      : null;
    const semantics = window.__cmDebug?.semantics?.() ?? null;
    const treeString = window.__cmDebug?.treeString?.() ?? "";
    const dialogCount = visibleCount('[role="dialog"]');
    const hoverPreviewCount = visibleCount(".cf-hover-preview-tooltip");
    const autocompleteCount = visibleCount(".cm-tooltip-autocomplete");

    if (!modeLabels.has(mode)) {
      issues.push(`invalid mode: ${String(mode)}`);
    }
    if (docLength < 0) {
      issues.push(`invalid doc length: ${docLength}`);
    }
    if (selection) {
      if (selection.anchor < 0 || selection.anchor > docLength) {
        issues.push(`selection.anchor out of bounds: ${selection.anchor}/${docLength}`);
      }
      if (selection.head < 0 || selection.head > docLength) {
        issues.push(`selection.head out of bounds: ${selection.head}/${docLength}`);
      }
    } else {
      issues.push("missing main selection");
    }

    if (!semantics || typeof semantics.revision !== "number" || Number.isNaN(semantics.revision)) {
      issues.push("invalid semantic revision info");
    }
    if (typeof treeString !== "string" || treeString.length === 0) {
      issues.push("missing syntax tree string");
    }
    if (dialogCount > limits.maxVisibleDialogs) {
      issues.push(`too many visible dialogs: ${dialogCount}/${limits.maxVisibleDialogs}`);
    }
    if (hoverPreviewCount > limits.maxVisibleHoverPreviews) {
      issues.push(
        `too many visible hover previews: ${hoverPreviewCount}/${limits.maxVisibleHoverPreviews}`,
      );
    }
    if (autocompleteCount > limits.maxAutocompleteTooltips) {
      issues.push(
        `too many autocomplete tooltips: ${autocompleteCount}/${limits.maxAutocompleteTooltips}`,
      );
    }

    return {
      mode,
      docLength,
      selection,
      semantics,
      treeErrorNodeCount: typeof treeString === "string" ? (treeString.match(/⚠/g) ?? []).length : 0,
      dialogCount,
      hoverPreviewCount,
      autocompleteCount,
      issues,
    };
  }, {
    maxVisibleDialogs,
    maxVisibleHoverPreviews,
    maxAutocompleteTooltips,
  });
}

/**
 * Assert that the generic editor/app health snapshot is clean.
 *
 * @param {import("playwright").Page} page
 * @param {string} label
 * @param {{
 *   maxVisibleDialogs?: number,
 *   maxVisibleHoverPreviews?: number,
 *   maxAutocompleteTooltips?: number,
 * }} [options]
 */
export async function assertEditorHealth(page, label, options = {}) {
  const health = await collectEditorHealth(page, options);
  if (health.issues.length > 0) {
    throw new Error(`${label}: ${health.issues.join("; ")}`);
  }
  return health;
}

/**
 * Create a flag-value parser for CLI arguments.
 *
 * @param {string[]} [argv] - defaults to process.argv.slice(2)
 * @returns {{ getFlag: (flag: string, fallback?: string) => string|undefined, getIntFlag: (flag: string, fallback?: number) => number, hasFlag: (flag: string) => boolean }}
 */
export function createArgParser(argv = process.argv.slice(2)) {
  const getFlag = (flag, fallback = undefined) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const getIntFlag = (flag, fallback) => {
    const value = getFlag(flag);
    return value !== undefined ? parseInt(value, 10) : fallback;
  };
  const hasFlag = (flag) => argv.includes(flag);
  return { getFlag, getIntFlag, hasFlag };
}

/**
 * Wait for the debug bridge globals (__app, __cmView, __cmDebug, __cfDebug).
 *
 * @param {import("playwright").Page} page
 * @param {object} [options]
 * @param {number} [options.timeout=15000]
 */
export async function waitForDebugBridge(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(
    () => Boolean(window.__app && window.__cmView && window.__cmDebug && window.__cfDebug),
    { timeout },
  );
}

/**
 * Reset the editor to rich mode with a baseline regression document loaded.
 *
 * Browser regressions that intentionally save fixture edits must restore those
 * files before they finish, so the shared in-memory demo filesystem remains
 * clean across tests.
 *
 * @param {import("playwright").Page} page
 */
export async function resetEditorState(page) {
  await page.evaluate(() => {
    window.__app?.setSearchOpen?.(false);
  }).catch(() => {});
  const discarded = await discardCurrentFile(page).catch(() => false);
  if (!discarded) {
    throw new Error("Failed to discard the current document during reset");
  }
  await page.evaluate(() => {
    window.__app.setMode("rich");
  });
  await openRegressionDocument(page);
  await page.waitForFunction(
    () => {
      const doc = window.__cmView?.state?.doc?.toString() ?? "";
      return doc.includes("# Math") && doc.includes("function isPrime");
    },
    { timeout: 5000 },
  );
}

/**
 * Take a screenshot.
 *
 * Chrome 145's CDP has a headed-mode bug where Page.captureScreenshot
 * hangs indefinitely. If the default page.screenshot() times out, we
 * launch a temporary headless browser, navigate to the same URL, and
 * capture there. The headless instance won't have app state (editor
 * content, scroll position) so this is a last-resort fallback.
 *
 * Prefer running Chrome in headless mode (`--headless=new`) when
 * screenshots are needed. See CLAUDE.md "Browser testing" section.
 */
export async function screenshot(page, path, options = {}) {
  await page.screenshot({ path, ...options });
}

/**
 * Disconnect from browser gracefully.
 * Swallows errors in case the browser is already closed.
 *
 * @param {import("playwright").Page} page
 */
export async function disconnectBrowser(page) {
  try {
    await page.context().browser()?.close();
  } catch {
    // Ignore disconnect errors — the browser may already be closed
  }
}
