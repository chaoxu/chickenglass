/* global window */

import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { connectToChrome, findAppPage, inspectBrowserPages } from "./chrome-common.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import {
  DEBUG_BRIDGE_READY_PROMISES,
  DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  DEBUG_EDITOR_SELECTOR,
} from "../src/debug/debug-bridge-contract.js";

const DEFAULT_PORT = 9322;
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_BROWSER_MODE = "cdp";
const DEFAULT_MANAGED_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;

const browserCleanupByPage = new WeakMap();

function formatInspectablePages(pages) {
  if (pages.length === 0) return "<none>";
  return pages
    .map((page) => `[${page.contextIndex}:${page.pageIndex}] ${page.url || "<blank>"} score=${page.score}`)
    .join(" | ");
}

function debugBridgePredicateArgs() {
  return {
    editorSelector: DEBUG_EDITOR_SELECTOR,
    requiredGlobals: DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  };
}

export function hasDebugBridgeGlobals({ editorSelector, requiredGlobals }) {
  return Boolean(
    requiredGlobals.every((name) => Boolean(window[name]))
      && (window.__cmView || document.querySelector(editorSelector)),
  );
}

export async function pageHasDebugBridge(page) {
  return page.evaluate(
    hasDebugBridgeGlobals,
    debugBridgePredicateArgs(),
  ).catch(() => false);
}

/** Promise-based sleep. */
export function sleep(ms) {
  return delay(ms);
}

export function normalizeConnectEditorOptions(portOrOptions = DEFAULT_PORT, options = {}) {
  const rawOptions = typeof portOrOptions === "object" && portOrOptions !== null
    ? portOrOptions
    : {
        ...options,
        port: portOrOptions ?? options.port,
      };

  const browser = rawOptions.browser ?? DEFAULT_BROWSER_MODE;
  if (browser !== "cdp" && browser !== "managed") {
    throw new Error(`Unsupported browser mode "${browser}". Use "cdp" or "managed".`);
  }

  return {
    browser,
    headless: rawOptions.headless ?? browser === "managed",
    port: rawOptions.port ?? DEFAULT_PORT,
    predicate: rawOptions.predicate ?? pageHasDebugBridge,
    timeout: rawOptions.timeout ?? DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS,
    url: rawOptions.url ?? DEFAULT_APP_URL,
    viewport: rawOptions.viewport ?? DEFAULT_MANAGED_VIEWPORT,
    waitForBridge: rawOptions.waitForBridge ?? true,
  };
}

export async function waitForAppUrl(
  url,
  { timeout = DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS, intervalMs = 250 } = {},
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
      });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch (_error) {
      // Retry until the timeout expires.
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for app URL ${url}`);
}

export function isLoopbackAppUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

export function buildViteDevArgs(url) {
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const host = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
  return ["dev", "--", "--host", host, "--port", port, "--strictPort"];
}

async function isAppServerReachable(url) {
  try {
    await waitForAppUrl(url, { timeout: 750, intervalMs: 150 });
    return true;
  } catch (_error) {
    return false;
  }
}

function collectChildOutput(child) {
  const lines = [];
  const append = (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > 30) lines.shift();
    }
  };

  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  return () => lines.join("\n");
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

export async function startAppServer(url) {
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    buildViteDevArgs(url),
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const getOutput = collectChildOutput(child);
  const exitPromise = waitForExit(child);
  let exited = false;
  void exitPromise.then(() => {
    exited = true;
  });

  try {
    await Promise.race([
      waitForAppUrl(url, { timeout: 30_000, intervalMs: 250 }),
      exitPromise.then(({ code, signal }) => {
        throw new Error(
          `Vite dev server exited before ${url} became reachable (code=${code}, signal=${signal}).\n${getOutput()}`,
        );
      }),
    ]);
  } catch (error) {
    if (!exited) {
      child.kill("SIGTERM");
    }
    throw error;
  }

  return async () => {
    if (exited) return;
    child.kill("SIGTERM");
    await Promise.race([
      exitPromise,
      sleep(2000),
    ]);
    if (!exited) {
      child.kill("SIGKILL");
      await Promise.race([
        exitPromise,
        sleep(500),
      ]);
    }
  };
}

export async function ensureAppServer(url, { autoStart = true, log = console.log } = {}) {
  if (await isAppServerReachable(url)) {
    return null;
  }
  if (!autoStart || !isLoopbackAppUrl(url)) {
    return null;
  }

  log(`Starting Vite dev server for ${url}...\n`);
  return startAppServer(url);
}

/**
 * Open the editor in either a Playwright-owned browser (`managed`) or the
 * legacy shared CDP lane (`cdp`).
 */
export async function connectEditor(portOrOptions = DEFAULT_PORT, options = {}) {
  const resolved = normalizeConnectEditorOptions(portOrOptions, options);

  if (resolved.browser === "managed") {
    await waitForAppUrl(resolved.url, { timeout: resolved.timeout });
    const browser = await chromium.launch({
      headless: resolved.headless,
    });
    const context = await browser.newContext({
      viewport: resolved.viewport,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(resolved.timeout);
    await page.goto(resolved.url, { waitUntil: "domcontentloaded" });
    browserCleanupByPage.set(page, async () => {
      await browser.close();
    });
    if (resolved.waitForBridge) {
      try {
        await waitForDebugBridge(page, { timeout: resolved.timeout });
      } catch (error) {
        await disconnectBrowser(page);
        throw error;
      }
    }
    return page;
  }

  const browser = await connectToChrome(resolved.port);
  if (!browser) {
    throw new Error(
      `Unable to connect to Chrome over CDP on port ${resolved.port}. Start Chrome with pnpm chrome or use browser: "managed".`,
    );
  }
  let page = await findAppPage(browser, {
    targetUrl: resolved.url,
    predicate: resolved.predicate,
  });
  if (!page) {
    await sleep(1000);
    page = await findAppPage(browser, {
      targetUrl: resolved.url,
      predicate: resolved.predicate,
    });
  }
  if (!page) {
    const pages = await inspectBrowserPages(browser, {
      targetUrl: resolved.url,
      predicate: resolved.predicate,
    });
    throw new Error(
      `No app page found over CDP${resolved.url ? ` for ${resolved.url}` : ""}. Open pages: ${formatInspectablePages(pages)}`,
    );
  }
  await page.bringToFront().catch(() => {});
  page.setDefaultTimeout(
    Math.min(resolved.timeout, DEFAULT_RUNTIME_BUDGET_PROFILE.fixtureOpenTimeoutMs),
  );
  browserCleanupByPage.set(page, async () => {
    await browser.close();
  });
  if (resolved.waitForBridge) {
    try {
      await waitForDebugBridge(page, { timeout: resolved.timeout });
    } catch (error) {
      await disconnectBrowser(page);
      throw error;
    }
  }
  return page;
}

async function waitForDebugBridgeReady(page, timeout) {
  const readiness = await page.evaluate(async ({ readyPromises, timeoutMs }) => {
    const sources = readyPromises
      .map((entry) => {
        const host = window[entry.globalName];
        return {
          name: `${entry.globalName}.${entry.propertyName}`,
          promise: host?.[entry.propertyName],
        };
      })
      .filter((source) => source.promise && typeof source.promise.then === "function");
    const missing = readyPromises
      .map((entry) => `${entry.globalName}.${entry.propertyName}`)
      .filter((name) => !sources.some((source) => source.name === name));
    const state = new Map(sources.map((source) => [source.name, "pending"]));

    if (missing.length > 0) {
      return {
        status: "missing",
        missing,
        pending: [],
        rejected: [],
      };
    }

    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          status: "timeout",
          pending: [...state.entries()]
            .filter(([, status]) => status === "pending")
            .map(([name]) => name),
          rejected: [...state.entries()]
            .filter(([, status]) => status === "rejected")
            .map(([name]) => name),
        });
      }, timeoutMs);
    });
    const readyPromise = Promise.all(sources.map((source) =>
      Promise.resolve(source.promise).then(
        () => {
          state.set(source.name, "ready");
        },
        () => {
          state.set(source.name, "rejected");
        },
      )
    )).then(() => ({
      status: [...state.values()].includes("rejected") ? "rejected" : "ready",
      pending: [...state.entries()]
        .filter(([, status]) => status === "pending")
        .map(([name]) => name),
      rejected: [...state.entries()]
        .filter(([, status]) => status === "rejected")
        .map(([name]) => name),
    }));

    return Promise.race([readyPromise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }, {
    readyPromises: DEBUG_BRIDGE_READY_PROMISES,
    timeoutMs: timeout,
  });

  if (readiness.status === "timeout") {
    throw new Error(
      `debug bridge readiness timed out after ${timeout}ms; pending: ${readiness.pending.join(", ") || "none"}`,
    );
  }
  if (readiness.status === "missing") {
    throw new Error(
      `debug bridge readiness missing promise(s): ${readiness.missing.join(", ")}`,
    );
  }
  if (readiness.status === "rejected") {
    throw new Error(
      `debug bridge readiness rejected: ${readiness.rejected.join(", ") || "unknown"}`,
    );
  }
  return readiness;
}

async function collectDebugBridgeDiagnostics(page) {
  return page.evaluate(({ editorSelector, readyPromises, requiredGlobals }) => {
    const globals = Object.fromEntries(
      requiredGlobals.map((name) => [name, Boolean(window[name])]),
    );
    globals.__cmView = Boolean(window.__cmView);
    globals.__cmDebug = Boolean(window.__cmDebug);
    globals.lexicalEditor = Boolean(document.querySelector(editorSelector));
    return {
      readyState: document.readyState,
      globals,
      readiness: readyPromises.map((entry) => ({
        name: `${entry.globalName}.${entry.propertyName}`,
        present: Boolean(
          window[entry.globalName]?.[entry.propertyName]
            && typeof window[entry.globalName][entry.propertyName].then === "function",
        ),
      })),
    };
  }, {
    editorSelector: DEBUG_EDITOR_SELECTOR,
    readyPromises: DEBUG_BRIDGE_READY_PROMISES,
    requiredGlobals: DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  }).catch((evaluateError) => ({
    readyState: "<unavailable>",
    globals: {},
    readiness: [],
    evaluateError: evaluateError instanceof Error ? evaluateError.message : String(evaluateError),
  }));
}

/**
 * Wait for the debug bridge globals. CM6 mode exposes CM6 globals; Lexical
 * mode exposes the product-neutral `__editor` bridge plus the Lexical root.
 *
 * @param {import("playwright").Page} page
 * @param {object} [options]
 * @param {number} [options.timeout=DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs]
 */
export async function waitForDebugBridge(
  page,
  { timeout = DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS } = {},
) {
  try {
    await page.waitForFunction(
      hasDebugBridgeGlobals,
      debugBridgePredicateArgs(),
      { timeout, polling: 100 },
    );
    await waitForDebugBridgeReady(page, timeout);
  } catch (error) {
    const title = await page.title().catch(() => "");
    const diagnostics = await collectDebugBridgeDiagnostics(page);
    const browser = page.context().browser();
    const pages = browser ? await inspectBrowserPages(browser, {}) : [];
    const missingGlobals = DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES
      .filter((name) => !diagnostics.globals[name]);
    if (!diagnostics.globals.__cmView && !diagnostics.globals.lexicalEditor) {
      missingGlobals.push(`__cmView or ${DEBUG_EDITOR_SELECTOR}`);
    }
    const pendingReady = diagnostics.readiness
      ?.filter((entry) => entry.present)
      .map((entry) => entry.name) ?? [];
    const missingReady = diagnostics.readiness
      ?.filter((entry) => !entry.present)
      .map((entry) => entry.name) ?? [];
    const reason = missingGlobals.length > 0
      ? `missing ${missingGlobals.join(", ")}`
      : diagnostics.evaluateError ?? (
          error instanceof Error ? error.message : String(error)
        );
    const readinessSuffix = pendingReady.length > 0
      ? `; ready promises present: ${pendingReady.join(", ")}`
      : "";
    const missingReadinessSuffix = missingReady.length > 0
      ? `; ready promises missing: ${missingReady.join(", ")}`
      : "";
    throw new Error(
      `Timed out waiting for debug bridge on ${page.url() || "<blank>"}${title ? ` (${title})` : ""}; readyState=${diagnostics.readyState}; ${reason}${readinessSuffix}${missingReadinessSuffix}. Open pages: ${formatInspectablePages(pages)}`,
    );
  }
}

/**
 * Disconnect from browser gracefully.
 * Swallows errors in case the browser is already closed.
 *
 * @param {import("playwright").Page} page
 */
export async function disconnectBrowser(page) {
  try {
    const cleanup = browserCleanupByPage.get(page);
    if (cleanup) {
      browserCleanupByPage.delete(page);
      await cleanup();
      return;
    }

    await page.context().browser()?.close();
  } catch (_error) {
    // Ignore disconnect errors: the browser may already be closed.
  }
}
