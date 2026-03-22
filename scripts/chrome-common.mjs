#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

export function parseChromeArgs(argv = process.argv.slice(2)) {
  const getValue = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };

  const port = parseInt(getValue("--port", "9322"), 10);
  const url = getValue("--url", "http://localhost:5173");
  const profileName = getValue("--profile", "app");
  const activate = argv.includes("--no-activate")
    ? false
    : argv.includes("--activate");

  return {
    port,
    url,
    activate,
    profileDir: resolve(homedir(), ".codex/tmp/coflat/chrome-testing", profileName),
  };
}

export function resolveChromeBinary() {
  return chromium.executablePath();
}

export function resolveChromeAppBundle(binaryPath) {
  return dirname(dirname(dirname(binaryPath)));
}

export function ensureProfileDir(profileDir) {
  mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

export async function connectToChrome(port) {
  try {
    return await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch {
    return null;
  }
}

export async function findFirstPage(browser) {
  for (const context of browser.contexts()) {
    const page = context.pages()[0];
    if (page) return page;
  }
  return null;
}

export async function reuseChromeApp(port, url) {
  const browser = await connectToChrome(port);
  if (!browser) return null;

  const page = await findFirstPage(browser);
  if (page) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  await browser.close();
  return { reused: true, hasPage: Boolean(page) };
}

export async function waitForChrome(port, attempts = 20, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const browser = await connectToChrome(port);
    if (browser) {
      await browser.close();
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

export function launchChromeApp(binaryPath, { port, url, profileDir }) {
  const child = spawn(
    binaryPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--window-size=1280,900",
      `--app=${url}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--hide-crash-restore-bubble",
    ],
    {
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
  return child.pid ?? null;
}

export function activateChromeApp(appBundlePath) {
  if (process.platform !== "darwin") return;
  spawnSync("open", ["-a", appBundlePath], { stdio: "ignore" });
}
