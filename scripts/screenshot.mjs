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
import { connectEditor, openFile } from "./test-helpers.mjs";

const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const output =
  outputIdx >= 0 && outputIdx + 1 < args.length
    ? args[outputIdx + 1]
    : `/tmp/coflat-screenshot-${Date.now()}.png`;
const file =
  args.find((a, i) => a !== "--output" && (outputIdx < 0 || i !== outputIdx + 1)) ??
  "index.md";

let page;
try {
  page = await connectEditor();
} catch {
  console.error("Cannot connect to CDP.\nMake sure Chrome is running: npm run chrome");
  process.exit(1);
}

await openFile(page, file);
await page.screenshot({ path: output, fullPage: true });
console.log(output);
