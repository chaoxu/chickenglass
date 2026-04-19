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
import { parseChromeArgs } from "./chrome-common.mjs";
import {
  disconnectBrowser,
  openBrowserHarness,
  screenshot,
} from "./test-helpers.mjs";

const { browser: browserMode, headless, port, url } = parseChromeArgs();

let page;
try {
  page = await openBrowserHarness({
    browser: browserMode,
    headless,
    port,
    url,
  });
} catch (error) {
  console.error(`Failed to open browser harness for ${url}.`);
  if (browserMode === "cdp") {
    console.error(`Make sure Chrome is running on CDP port ${port}: npm run chrome:app`);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Connected to ${await page.title()} — ${page.url()}`);

const path = `/tmp/coflat-test-cdp-${Date.now()}.png`;
await screenshot(page, path, { timeout: 1500 });
console.log(`Screenshot saved: ${path}`);

await disconnectBrowser(page);
