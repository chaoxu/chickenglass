#!/usr/bin/env node
/**
 * Take a screenshot of the editor showing a specific file.
 *
 * Usage:
 *   node scripts/screenshot.mjs [file] [--output path.png]
 *
 * Requires: pnpm chrome (CDP on port 9322) running first.
 */

import process from "node:process";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import { createArgParser, openFile, screenshot } from "./test-helpers.mjs";

const args = process.argv.slice(2);
const { getFlag, getPositionals } = createArgParser(args);
const output = getFlag("--output", `/tmp/coflat-screenshot-${Date.now()}.png`);
const file = getPositionals()[0] ?? "index.md";

let session;
try {
  session = await openBrowserSession(args, { defaultBrowser: "cdp" });
} catch {
  console.error("Cannot connect to CDP.\nMake sure Chrome is running: pnpm chrome");
  process.exit(1);
}

try {
  const { page } = session;
  await openFile(page, file);
  await screenshot(page, output, { fullPage: true });
  console.log(output);
} finally {
  await closeBrowserSession(session);
}
