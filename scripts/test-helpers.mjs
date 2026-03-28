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
 * Open a file by path (e.g. "posts/2014-11-04-isotonic-....md").
 * Uses the app's real openFile function via window.__app.
 */
export async function openFile(page, path) {
  await page.evaluate((p) => window.__app.openFile(p), path);
  await sleep(500);
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
 * Reset the editor to rich mode with index.md loaded (baseline state).
 *
 * @param {import("playwright").Page} page
 */
export async function resetEditorState(page) {
  await page.evaluate(() => {
    window.__app.setMode("rich");
    window.__app.openFile("index.md");
  });
  await page.waitForFunction(
    () => window.__cmView?.state?.doc?.length > 100,
    { timeout: 5000 },
  ).catch(() => {});
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
