#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createArgParser } from "./devx-cli.mjs";

export function parseChromeArgs(
  argv = process.argv.slice(2),
  defaults = {},
) {
  const { getFlag, getIntFlag, hasFlag } = createArgParser(argv);

  const port = getIntFlag("--port", 9322);
  const url = getFlag("--url", defaults.url ?? "http://localhost:5173");
  const profileName = getFlag("--profile", defaults.profileName ?? "app");
  const browser = getFlag("--browser", defaults.browser ?? "cdp");
  const activate = hasFlag("--no-activate")
    ? false
    : hasFlag("--activate")
      ? true
      : defaults.activate ?? false;
  const headless = hasFlag("--headed")
    ? false
    : hasFlag("--headless")
      ? true
      : defaults.headless ?? browser === "managed";

  return {
    port,
    url,
    browser,
    headless,
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
  // Disable session restore so Chrome doesn't open a second window
  // restoring the previous session alongside the new --app window.
  const defaultDir = join(profileDir, "Default");
  mkdirSync(defaultDir, { recursive: true });
  const prefsPath = join(defaultDir, "Preferences");
  try {
    const prefs = existsSync(prefsPath)
      ? JSON.parse(readFileSync(prefsPath, "utf-8"))
      : {};
    // Prevent session restore — only --app window should open
    if (!prefs.session) prefs.session = {};
    prefs.session.restore_on_startup = 4; // 4 = open URL list (empty = nothing)
    if (!prefs.session.startup_urls) prefs.session.startup_urls = [];
    // Mark previous exit as clean so Chrome doesn't show restore prompt
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exited_cleanly = true;
    prefs.profile.exit_type = "Normal";
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    writeFileSync(prefsPath, JSON.stringify({
      session: { restore_on_startup: 4, startup_urls: [] },
      profile: { exited_cleanly: true, exit_type: "Normal" },
    }));
  }
  return profileDir;
}

export async function connectToChrome(port) {
  try {
    return await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch {
    return null;
  }
}

function normalizeTargetUrl(targetUrl) {
  if (!targetUrl) return null;
  try {
    return new URL(targetUrl);
  } catch {
    return null;
  }
}

function isInspectablePageUrl(url) {
  if (!url) return false;
  return !/^(about:blank|chrome-error:\/\/|chrome:\/\/|devtools:\/\/|edge:\/\/)/.test(url);
}

export function scorePageCandidate(url, { targetUrl } = {}) {
  if (!isInspectablePageUrl(url)) {
    return Number.NEGATIVE_INFINITY;
  }

  let candidate;
  try {
    candidate = new URL(url);
  } catch {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const normalizedTarget = normalizeTargetUrl(targetUrl);
  if (normalizedTarget) {
    if (candidate.href === normalizedTarget.href) {
      score += 1200;
    } else if (
      candidate.origin === normalizedTarget.origin &&
      candidate.pathname === normalizedTarget.pathname
    ) {
      score += 1000;
    } else if (candidate.origin === normalizedTarget.origin) {
      score += 800;
    } else if (candidate.hostname === normalizedTarget.hostname) {
      score += 300;
    }
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])$/u.test(candidate.hostname)) {
    score += 200;
  }
  if (candidate.pathname && candidate.pathname !== "/") {
    score += 25;
  }
  if (candidate.search) {
    score += 5;
  }

  return score;
}

export async function inspectBrowserPages(browser, options = {}) {
  const entries = [];
  for (const [contextIndex, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      const url = page.url();
      const baseScore = scorePageCandidate(url, options);
      let predicateMatch = false;
      if (baseScore > Number.NEGATIVE_INFINITY && typeof options.predicate === "function") {
        try {
          predicateMatch = Boolean(await Promise.race([
            options.predicate(page),
            sleep(250).then(() => false),
          ]));
        } catch {
          predicateMatch = false;
        }
      }

      const title = options.includeTitle
        ? await Promise.race([
            page.title().catch(() => ""),
            sleep(250).then(() => "<title-timeout>"),
          ])
        : "";

      entries.push({
        contextIndex,
        pageIndex,
        page,
        url,
        title,
        score: baseScore + (predicateMatch ? 1000 : 0),
        predicateMatch,
      });
    }
  }
  return entries;
}

export async function findAppPage(browser, options = {}) {
  const entries = await inspectBrowserPages(browser, options);
  const bestMatch = entries
    .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.contextIndex - right.contextIndex || left.pageIndex - right.pageIndex)[0];
  return bestMatch?.page ?? null;
}

export async function findFirstPage(browser) {
  return findAppPage(browser);
}

export async function reuseChromeApp(port, url) {
  const browser = await connectToChrome(port);
  if (!browser) return null;

  const page = await findAppPage(browser, { targetUrl: url });
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
      "--noerrdialogs",
      "--disable-session-crashed-bubble",
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
