#!/usr/bin/env node
/**
 * Connect to the running Chrome for Testing instance via CDP and run a quick test.
 *
 * Requires: pnpm chrome:app (or chrome:cdp) running first.
 *
 * Usage:
 *   pnpm chrome:test
 *   node scripts/test-chrome.mjs --port 9322
 */

import console from "node:console";
import process from "node:process";
import { screenshot } from "./browser-screenshot.mjs";
import { connectToChrome, findAppPage, inspectBrowserPages, parseChromeArgs } from "./chrome-common.mjs";

const { port, url } = parseChromeArgs();

const browser = await connectToChrome(port);
if (!browser) {
  console.error(`Failed to connect to CDP on port ${port}.`);
  console.error("Make sure Chrome is running: pnpm chrome:app");
  process.exit(1);
}

const page = await findAppPage(browser, { targetUrl: url });
if (!page) {
  const pages = await inspectBrowserPages(browser, { targetUrl: url });
  const summary = pages.length > 0
    ? pages.map((entry) => `[${entry.contextIndex}:${entry.pageIndex}] ${entry.url || "<blank>"}`).join(" | ")
    : "<none>";
  console.error(`No app page found for ${url}. Open pages: ${summary}`);
  await browser.close();
  process.exit(1);
}

console.log(`Connected to ${await page.title()} — ${page.url()}`);

const path = `test-cdp-${Date.now()}.png`;
await screenshot(page, path);
console.log(`Screenshot saved: ${path}`);

await browser.close();
