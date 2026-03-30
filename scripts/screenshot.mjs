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
import { connectEditor, openFile, screenshot, createArgParser, disconnectBrowser } from "./test-helpers.mjs";

const args = process.argv.slice(2);
const { getFlag } = createArgParser(args);
const output = getFlag("--output", `/tmp/coflat-screenshot-${Date.now()}.png`);

// Get positional arguments (first non-flag arg that isn't a flag value)
const outputIdx = args.indexOf("--output");
const file =
  args.find((a, i) => !a.startsWith("-") && (outputIdx < 0 || i !== outputIdx + 1)) ??
  "index.md";

let page;
try {
  page = await connectEditor();
} catch {
  console.error("Cannot connect to CDP.\nMake sure Chrome is running: npm run chrome");
  process.exit(1);
}

await openFile(page, file);
await screenshot(page, output, { fullPage: true });
console.log(output);

await disconnectBrowser(page);
