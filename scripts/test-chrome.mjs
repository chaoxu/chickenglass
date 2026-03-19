#!/usr/bin/env node
/**
 * Connect to the running Chromium instance via CDP and run a quick test.
 *
 * Requires: npm run chrome (running in another terminal)
 *
 * Usage:
 *   npm run chrome:test
 *   node scripts/test-chrome.mjs --port 9322
 */

import { chromium } from "playwright";

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "9322", 10);

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  // --app mode may put the page in any context
  let page;
  for (const ctx of browser.contexts()) {
    if (ctx.pages().length > 0) { page = ctx.pages()[0]; break; }
  }
  if (!page) {
    // Fallback: wait briefly for the page to appear
    await new Promise(r => setTimeout(r, 1000));
    for (const ctx of browser.contexts()) {
      if (ctx.pages().length > 0) { page = ctx.pages()[0]; break; }
    }
  }
  if (!page) {
    console.error("No page found. Is Chrome running with npm run chrome?");
    process.exit(1);
  }

  console.log(`Connected to ${await page.title()} — ${page.url()}`);

  // Quick screenshot
  const path = `test-cdp-${Date.now()}.png`;
  await page.screenshot({ path });
  console.log(`Screenshot saved: ${path}`);

  // Don't close — we're just connecting, not owning the browser
  browser.close(); // disconnects CDP session, doesn't kill Chrome
} catch (err) {
  console.error(`Failed to connect to CDP on port ${PORT}:`, err.message);
  console.error("Make sure Chrome is running: npm run chrome");
  process.exit(1);
}
