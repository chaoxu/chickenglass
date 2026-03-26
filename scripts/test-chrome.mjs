#!/usr/bin/env node
/**
 * Connect to the running Chrome for Testing instance via CDP and run a quick test.
 *
 * Requires: npm run chrome:app (or chrome:cdp) running first.
 *
 * Usage:
 *   npm run chrome:test
 *   node scripts/test-chrome.mjs --port 9322
 */

import console from "node:console";
import process from "node:process";
import { connectToChrome, findFirstPage, parseChromeArgs } from "./chrome-common.mjs";
import { screenshot } from "./test-helpers.mjs";

const { port } = parseChromeArgs();

const browser = await connectToChrome(port);
if (!browser) {
  console.error(`Failed to connect to CDP on port ${port}.`);
  console.error("Make sure Chrome is running: npm run chrome:app");
  process.exit(1);
}

const page = await findFirstPage(browser);
if (!page) {
  console.error("No page found. Is Chrome running with npm run chrome:app?");
  await browser.close();
  process.exit(1);
}

console.log(`Connected to ${await page.title()} — ${page.url()}`);

const path = `test-cdp-${Date.now()}.png`;
await screenshot(page, path);
console.log(`Screenshot saved: ${path}`);

await browser.close();
