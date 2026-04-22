#!/usr/bin/env node
/**
 * Launch Playwright's bundled Chrome for Testing in app mode with a fixed CDP port.
 *
 * Usage:
 *   pnpm chrome:app               # visible app-mode preview on port 9322
 *   pnpm chrome:app -- --url http://127.0.0.1:4173
 *   pnpm chrome:cdp               # launch/reuse without macOS activation
 *
 * This command is the repo-standard local browser-debug facility:
 * - always targets Playwright's bundled Chrome for Testing
 * - always uses a dedicated user-data-dir outside the repo
 * - reuses an existing browser on the same CDP port when possible
 * - explicitly activates Google Chrome for Testing on macOS
 */

import console from "node:console";
import process from "node:process";
import {
  activateChromeApp,
  ensureProfileDir,
  launchChromeApp,
  parseChromeArgs,
  resolveChromeAppBundle,
  resolveChromeBinary,
  reuseChromeApp,
  waitForChrome,
} from "./chrome-common.mjs";

const args = parseChromeArgs();
const binary = resolveChromeBinary();
const appBundle = resolveChromeAppBundle(binary);
const profileDir = ensureProfileDir(args.profileDir);

const reused = await reuseChromeApp(args.port, args.url);
if (reused) {
  if (args.activate) {
    activateChromeApp(appBundle);
  }
  console.log(`Chrome for Testing app reused — ${args.url}`);
  console.log(`CDP on ws://localhost:${args.port}`);
  console.log(`Profile: ${profileDir}`);
  if (!reused.hasPage) {
    console.log("No existing app page was found over CDP; browser left running.");
  }
  process.exit(0);
}

const pid = launchChromeApp(binary, args);
const ready = await waitForChrome(args.port);
if (args.activate) {
  activateChromeApp(appBundle);
}

console.log(`Chrome for Testing app launched — ${args.url}`);
console.log(`CDP on ws://localhost:${args.port}`);
console.log(`Profile: ${profileDir}`);
if (pid !== null) {
  console.log(`PID: ${pid}`);
}
if (!ready) {
  console.log("Warning: Chrome launched, but CDP was not reachable yet.");
}
