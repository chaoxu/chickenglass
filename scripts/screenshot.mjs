#!/usr/bin/env node
/**
 * Take a screenshot of the editor showing a specific file.
 *
 * Usage:
 *   node scripts/screenshot.mjs [file] [--output path.png]
 *
 * Requires: npm run chrome (CDP on port 9322) running first.
 */

import console from "node:console";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { connectToChrome, findFirstPage } from "./chrome-common.mjs";

const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const output =
  outputIdx >= 0 && outputIdx + 1 < args.length
    ? args[outputIdx + 1]
    : `/tmp/coflat-screenshot-${Date.now()}.png`;
const file =
  args.find((a, i) => a !== "--output" && (outputIdx < 0 || i !== outputIdx + 1)) ??
  "index.md";

const PORT = 9322;

const browser = await connectToChrome(PORT);
if (!browser) {
  console.error(
    `Cannot connect to CDP on port ${PORT}.\nMake sure Chrome is running: npm run chrome`,
  );
  process.exit(1);
}

const page = await findFirstPage(browser);
if (!page) {
  console.error("No page found. Is Chrome running with npm run chrome?");
  await browser.close();
  process.exit(1);
}

page.setDefaultTimeout(10_000);
await page.evaluate((f) => window.__app.openFile(f), file);
await sleep(500);
await page.screenshot({ path: output, fullPage: true });
console.log(output);

await browser.close();
