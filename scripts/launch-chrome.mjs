#!/usr/bin/env node
/**
 * Launch Playwright's bundled Chromium in app mode with a fixed CDP port.
 *
 * Usage:
 *   npm run chrome              # launches on port 9322
 *   npm run chrome -- --port 9333
 *
 * Connect via Playwright:
 *   const browser = await chromium.connectOverCDP('http://localhost:9322');
 */

import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "9322", 10);
const URL = process.argv.find((_, i, a) => a[i - 1] === "--url") ?? "http://localhost:5173";

// Find the Playwright Chromium binary
const chromePath = execSync("npx playwright install --dry-run 2>/dev/null | grep 'Install location' | head -1 | awk '{print $NF}'", { encoding: "utf-8" }).trim();
const binary = resolve(chromePath, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const child = spawn(binary, [
  `--remote-debugging-port=${PORT}`,
  `--window-size=1280,900`,
  `--app=${URL}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
  "--hide-crash-restore-bubble",
], {
  stdio: "ignore",
  detached: false,
});

console.log(`Chromium app launched — ${URL}`);
console.log(`CDP on ws://localhost:${PORT}`);
console.log(`PID: ${child.pid}`);
console.log(`Press Ctrl+C to close.`);

child.on("exit", (code) => {
  console.log(`Chrome exited (code ${code})`);
  process.exit(0);
});

process.on("SIGINT", () => {
  child.kill();
  process.exit(0);
});
