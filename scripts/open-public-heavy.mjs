#!/usr/bin/env node
/**
 * Open the public heavy fixture in the shared Chrome for Testing app window
 * driven over CDP (the same lane as `pnpm chrome`).
 *
 * Usage:
 *   pnpm build && pnpm preview &          # serve at :5188
 *   node scripts/open-public-heavy.mjs
 *
 * Reuses an existing CDP session on :9322 if one is running; otherwise
 * launches a detached Chrome window and then connects. After loading the
 * doc, the script exits — the browser window stays alive.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import {
  connectToChrome,
  ensureProfileDir,
  findAppPage,
  launchChromeApp,
  resolveChromeBinary,
  waitForChrome,
} from "./chrome-common.mjs";

const APP_URL = "http://localhost:5188/";
const CDP_PORT = 9322;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = resolve(process.env.HOME ?? "", ".codex/tmp/coflat/chrome-testing/public-heavy");

async function ensureBrowser() {
  const existing = await connectToChrome(CDP_PORT);
  if (existing) {
    process.stderr.write("reusing chrome on :9322\n");
    return existing;
  }
  process.stderr.write("launching chrome for testing\n");
  const binary = resolveChromeBinary();
  ensureProfileDir(PROFILE_DIR);
  launchChromeApp(binary, { port: CDP_PORT, url: APP_URL, profileDir: PROFILE_DIR });
  const ready = await waitForChrome(CDP_PORT);
  if (!ready) throw new Error("chrome never became reachable on :9322");
  const browser = await connectToChrome(CDP_PORT);
  if (!browser) throw new Error("connect after launch failed");
  return browser;
}

async function pickOrOpenPage(browser) {
  let page = await findAppPage(browser, { targetUrl: APP_URL });
  if (page) {
    if (!page.url().startsWith(APP_URL)) {
      await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    }
    return page;
  }
  const [context] = browser.contexts();
  page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  return page;
}

async function main() {
  const [md, bib] = await Promise.all([
    readFile(resolve(REPO_ROOT, "demo/perf-heavy/main.md"), "utf8"),
    readFile(resolve(REPO_ROOT, "demo/perf-heavy/refs.bib"), "utf8"),
  ]);

  const browser = await ensureBrowser();
  try {
    const page = await pickOrOpenPage(browser);
    process.stderr.write("waiting for debug bridge\n");
    await page.waitForFunction(() => Boolean(window.__app && window.__editor), null, { timeout: 30000 });
    await page.evaluate(async () => {
      await Promise.all([window.__app.ready, window.__editor.ready]);
    });
    process.stderr.write("loading ref.bib\n");
    await page.evaluate(async (bibText) => {
      await window.__app.openFileWithContent("perf-heavy/refs.bib", bibText);
    }, bib);
    // openFileWithContent commits the doc as dirty; the next switch would
    // block on the unsaved-changes dialog in preview mode, so discard first.
    await page.evaluate(async () => {
      await window.__app.closeFile({ discard: true });
    });
    await sleep(100);
    process.stderr.write("loading main.md\n");
    await page.evaluate(async (mdText) => {
      await window.__app.openFileWithContent("perf-heavy/main.md", mdText);
    }, md);
    process.stderr.write(`public heavy fixture loaded at ${APP_URL}\n`);
  } finally {
    // Disconnect from CDP without killing the detached browser.
    await browser.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
