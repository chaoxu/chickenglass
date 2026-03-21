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

import { chromium } from "playwright";

const DEFAULT_PORT = 9322;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFirstPage(browser) {
  for (const ctx of browser.contexts()) {
    if (ctx.pages().length > 0) return ctx.pages()[0];
  }
  return null;
}

/**
 * Connect to a running Chromium instance via CDP and return the page.
 * Requires `npm run chrome` running in another terminal.
 */
export async function connectEditor(port = DEFAULT_PORT) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  let page = findFirstPage(browser);
  if (!page) {
    await sleep(1000);
    page = findFirstPage(browser);
  }
  if (!page) throw new Error("No page found. Is Chrome running with npm run chrome?");
  page.setDefaultTimeout(10000);
  return page;
}

/**
 * Open a file by path (e.g. "posts/2014-11-04-isotonic-....md").
 * Uses window.__openFile which works regardless of sidebar scroll state.
 * Falls back to clicking the sidebar if __openFile is unavailable.
 */
export async function openFile(page, fileNameOrPath) {
  await page.evaluate((name) => {
    if (window.__openFile) {
      window.__openFile(name);
      return;
    }
    // Fallback: click sidebar span
    const spans = document.querySelectorAll("span");
    for (const s of spans) {
      if (s.textContent === name) {
        s.click();
        return;
      }
    }
    throw new Error(`File "${name}" not found`);
  }, fileNameOrPath);
  await sleep(500);
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
    const lb = view.lineBlockAt(view.state.doc.line(ln).from);
    view.scrollDOM.scrollTop = lb.top - 50;
  }, line);
  await sleep(200);
}
