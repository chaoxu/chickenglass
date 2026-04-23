#!/usr/bin/env node

import console from "node:console";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { screenshot } from "./browser-screenshot.mjs";
import { findAppPage, inspectBrowserPages } from "./chrome-common.mjs";

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(arg, next);
      index += 1;
    } else {
      flags.set(arg, "true");
    }
  }
  return {
    command: positional[0] ?? "",
    flag(name, fallback = "") {
      return flags.get(name) ?? fallback;
    },
    intFlag(name, fallback) {
      const raw = flags.get(name);
      if (!raw) return fallback;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
}

function tailText(text, lineCount = 200) {
  return text.split(/\r?\n/u).slice(-lineCount).join("\n");
}

function copyPreviewLog(previewLog, outDir) {
  if (!previewLog || !existsSync(previewLog)) {
    return null;
  }
  const target = join(outDir, "preview.log");
  copyFileSync(previewLog, target);
  return target;
}

function printPreviewLog(previewLog) {
  if (!previewLog || !existsSync(previewLog)) {
    console.log("No Vite preview log found.");
    return;
  }
  const text = readFileSync(previewLog, "utf-8");
  console.log("\n===== Vite preview log (tail) =====");
  console.log(tailText(text));
  console.log("===== End Vite preview log =====\n");
}

async function launchBrowser({ url, port, profileDir }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    args: [
      `--remote-debugging-port=${port}`,
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--hide-crash-restore-bubble",
      "--no-default-browser-check",
      "--no-first-run",
    ],
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log(`CI browser ready on CDP port ${port}: ${url}`);

  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`Closing CI browser after ${signal}.`);
    await context.close().catch((error) => {
      console.warn(
        `Failed to close CI browser cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    process.exit(0);
  };
  process.once("SIGINT", () => {
    close("SIGINT");
  });
  process.once("SIGTERM", () => {
    close("SIGTERM");
  });
  await new Promise(() => {});
}

async function waitForBrowser({ url, port, timeoutMs }) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    let browser = null;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = await findAppPage(browser, { targetUrl: url });
      if (page) {
        await browser.close();
        browser = null;
        console.log(`CI browser is reachable on CDP port ${port}.`);
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (browser) {
        await browser.close().catch((error) => {
          console.warn(
            `Failed to close temporary CDP connection: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
    await sleep(250);
  }
  const suffix = lastError ? ` Last connection error: ${lastError}` : "";
  throw new Error(`Timed out waiting ${timeoutMs}ms for CI browser on CDP port ${port}.${suffix}`);
}

async function collectPageState(page, label) {
  return page.evaluate(async (snapshotLabel) => {
    const safe = (read) => {
      try {
        return read();
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    const safeAsync = async (read) => {
      try {
        return await read();
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    const truncate = (value, maxLength = 2000) => {
      if (typeof value !== "string") return value;
      return value.length > maxLength
        ? `${value.slice(0, maxLength)}...<truncated ${value.length - maxLength} chars>`
        : value;
    };
    const doc = safe(() => window.__editor?.getDoc?.() ?? null);

    return {
      app: safe(() => ({
        currentDocument: window.__app?.getCurrentDocument?.() ?? null,
        dirty: window.__app?.isDirty?.() ?? null,
        mode: window.__app?.getMode?.() ?? null,
        projectRoot: window.__app?.getProjectRoot?.() ?? null,
      })),
      browser: {
        readyState: document.readyState,
        title: document.title,
        url: window.location.href,
      },
      cfDebug: await safeAsync(async () => ({
        captureState: await window.__cfDebug?.captureState?.(snapshotLabel),
        recorderStatus: window.__cfDebug?.recorderStatus?.() ?? null,
        renderState: window.__cfDebug?.renderState?.() ?? null,
      })),
      cmDebug: safe(() => ({
        fences: window.__cmDebug?.fences?.() ?? null,
        motionGuards: window.__cmDebug?.motionGuards?.() ?? null,
        renderState: window.__cmDebug?.renderState?.() ?? null,
        selection: window.__cmDebug?.selection?.() ?? null,
        structure: window.__cmDebug?.structure?.() ?? null,
      })),
      dom: safe(() => ({
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              testId: document.activeElement.getAttribute("data-testid"),
              text: truncate(document.activeElement.textContent ?? "", 500),
            }
          : null,
        bodyText: truncate(document.body?.innerText ?? "", 2000),
        errorOverlay: truncate(
          document.querySelector("vite-error-overlay")?.shadowRoot?.textContent
            ?? document.querySelector("vite-error-overlay")?.textContent
            ?? "",
          2000,
        ),
      })),
      editor: {
        docHead: typeof doc === "string" ? truncate(doc.slice(0, 1000), 1000) : null,
        docLength: typeof doc === "string" ? doc.length : null,
        docRead: typeof doc === "string" ? "ok" : doc,
        docTail: typeof doc === "string" ? truncate(doc.slice(-1000), 1000) : null,
        selection: safe(() => window.__editor?.getSelection?.() ?? null),
      },
    };
  }, label);
}

async function collectDiagnostics({ url, port, outDir, previewLog, label }) {
  mkdirSync(outDir, { recursive: true });
  const copiedPreviewLog = copyPreviewLog(previewLog, outDir);
  printPreviewLog(previewLog);

  let browser = null;
  const diagnostics = {
    capturedAt: new Date().toISOString(),
    label,
    pageState: null,
    pages: [],
    screenshot: null,
    url,
  };

  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const pages = await inspectBrowserPages(browser, {
      includeTitle: true,
      predicate: (page) => page.evaluate(() => Boolean(window.__app || window.__editor)),
      targetUrl: url,
    });
    diagnostics.pages = pages.map((entry) => ({
      contextIndex: entry.contextIndex,
      pageIndex: entry.pageIndex,
      predicateMatch: entry.predicateMatch,
      score: entry.score,
      title: entry.title,
      url: entry.url,
    }));

    const page = await findAppPage(browser, {
      predicate: (candidate) => candidate.evaluate(() => Boolean(window.__app || window.__editor)),
      targetUrl: url,
    });
    if (!page) {
      diagnostics.pageState = { error: "No app page found over CDP." };
    } else {
      diagnostics.pageState = await collectPageState(page, label);
      const screenshotPath = join(outDir, "app-screenshot.png");
      await screenshot(page, screenshotPath, { timeout: 5000 }).then(() => {
        diagnostics.screenshot = screenshotPath;
      }).catch((error) => {
        diagnostics.screenshot = {
          error: error instanceof Error ? error.message : String(error),
        };
      });
    }
  } catch (error) {
    diagnostics.pageState = {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (browser) {
      await browser.close().catch((error) => {
        console.warn(
          `Failed to close diagnostics CDP connection: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  const diagnosticsPath = join(outDir, "app-debug-state.json");
  writeFileSync(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`);

  console.log("===== Browser debug state =====");
  console.log(JSON.stringify({
    app: diagnostics.pageState?.app ?? null,
    browser: diagnostics.pageState?.browser ?? null,
    cmSelection: diagnostics.pageState?.cmDebug?.selection ?? null,
    currentDocument: diagnostics.pageState?.app?.currentDocument ?? null,
    editor: {
      docLength: diagnostics.pageState?.editor?.docLength ?? null,
      selection: diagnostics.pageState?.editor?.selection ?? null,
    },
    pages: diagnostics.pages,
    screenshot: diagnostics.screenshot,
  }, null, 2));
  console.log("===== End browser debug state =====");
  console.log(`Diagnostics written to ${outDir}`);
  if (copiedPreviewLog) {
    console.log(`Preview log copied to ${copiedPreviewLog}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.flag("--url", "http://127.0.0.1:4173");
  const port = args.intFlag("--port", 9322);
  const outDir = resolve(args.flag("--out-dir", "/tmp/coflats-browser-artifacts"));
  const profileDir = resolve(args.flag("--profile", "/tmp/coflats-ci-browser-profile"));
  const previewLog = args.flag("--preview-log", "");
  const timeoutMs = args.intFlag("--timeout", 30_000);
  const label = args.flag("--label", "ci-browser-failure");

  if (args.command === "launch") {
    await launchBrowser({ port, profileDir, url });
    return;
  }
  if (args.command === "wait") {
    await waitForBrowser({ port, timeoutMs, url });
    return;
  }
  if (args.command === "collect") {
    await collectDiagnostics({ label, outDir, port, previewLog, url });
    return;
  }

  throw new Error("Usage: ci-browser-diagnostics.mjs <launch|wait|collect> [--url URL] [--port PORT]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
