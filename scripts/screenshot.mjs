#!/usr/bin/env node
/**
 * Take a screenshot of the editor showing a specific file.
 *
 * Usage:
 *   node scripts/screenshot.mjs [file] [--output path.png]
 *
 * Requires: npm run chrome (CDP on port 9322) running first.
 */

import process from "node:process";
import { parseChromeArgs } from "./chrome-common.mjs";
import {
  createArgParser,
  disconnectBrowser,
  openBrowserHarness,
  openFile,
  screenshot,
} from "./test-helpers.mjs";

const args = process.argv.slice(2);
const { getFlag } = createArgParser(args);
const chromeArgs = parseChromeArgs(args);
const output = getFlag("--output", `/tmp/coflat-screenshot-${Date.now()}.png`);

// Get positional arguments (first non-flag arg that isn't a flag value)
const flagValueIndexes = new Set(
  ["--output", "--url", "--port", "--browser", "--profile"]
    .map((flag) => args.indexOf(flag))
    .filter((index) => index >= 0)
    .map((index) => index + 1),
);
const file =
  args.find((arg, index) => !arg.startsWith("-") && !flagValueIndexes.has(index)) ??
  "index.md";

let page;
try {
  page = await openBrowserHarness({
    browser: chromeArgs.browser,
    headless: chromeArgs.headless,
    port: chromeArgs.port,
    url: chromeArgs.url,
  });
} catch {
  console.error("Cannot open browser harness.\nFor CDP, make sure Chrome is running: npm run chrome");
  process.exit(1);
}

await openFile(page, file);
await screenshot(page, output, { fullPage: true });
console.log(output);

await disconnectBrowser(page);
