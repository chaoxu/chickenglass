/* global window */

import { chromium } from "playwright";
import { findAppPage, inspectBrowserPages } from "../chrome-common.mjs";
import {
  DEFAULT_APP_URL,
  DEFAULT_BROWSER_MODE,
  DEFAULT_MANAGED_VIEWPORT,
  DEFAULT_PORT,
  formatInspectablePages,
  pageHasDebugBridge,
  sleep,
} from "./shared.mjs";
import { CORE_DEBUG_GLOBAL_NAMES } from "../../src/debug/debug-bridge-contract.js";

const browserCleanupByPage = new WeakMap();

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
    timeout: rawOptions.timeout ?? 15000,
    url: rawOptions.url ?? DEFAULT_APP_URL,
    viewport: rawOptions.viewport ?? DEFAULT_MANAGED_VIEWPORT,
  };
}

export async function waitForAppUrl(
  url,
  { timeout = 15000, intervalMs = 250 } = {},
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
    } catch {
      // Retry until the timeout expires.
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for app URL ${url}`);
}

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
    return page;
  }

  const browser = await chromium.connectOverCDP(`http://localhost:${resolved.port}`);
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
  page.setDefaultTimeout(Math.min(resolved.timeout, 10000));
  browserCleanupByPage.set(page, async () => {
    await browser.close();
  });
  return page;
}

export async function waitForDebugBridge(page, { timeout = 15000 } = {}) {
  try {
    // First ensure the bridge globals exist (they install eagerly at module
    // load). Then await their `.ready` promises so methods are safe to call.
    await page.waitForFunction(
      ({ coreGlobals }) => coreGlobals.every((name) => Boolean(window[name])),
      { coreGlobals: CORE_DEBUG_GLOBAL_NAMES },
      { timeout },
    );
    await page.evaluate(
      async ({ readyTimeout }) => {
        const withTimeout = (label, promise) =>
          Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`ready:${label} timed out`)), readyTimeout),
            ),
          ]);
        await Promise.all([
          withTimeout("__app", window.__app.ready),
          withTimeout("__cfDebug", window.__cfDebug.ready),
        ]);
      },
      { readyTimeout: timeout },
    );
  } catch (error) {
    const title = await page.title().catch(() => "");
    const diagnostics = await page.evaluate(() => {
      const globals = {
        __app: Boolean(window.__app),
        __cfDebug: Boolean(window.__cfDebug),
        __editor: Boolean(window.__editor),
      };
      return {
        readyState: document.readyState,
        globals,
      };
    }).catch((evaluateError) => ({
      readyState: "<unavailable>",
      globals: {},
      evaluateError: evaluateError instanceof Error ? evaluateError.message : String(evaluateError),
    }));
    const browser = page.context().browser();
    const pages = browser ? await inspectBrowserPages(browser, {}) : [];
    const missingGlobals = Object.entries(diagnostics.globals)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    const reason = missingGlobals.length > 0
      ? `missing ${missingGlobals.join(", ")}`
      : diagnostics.evaluateError ?? (error instanceof Error ? error.message : String(error));
    throw new Error(
      `Timed out waiting for debug bridge on ${page.url() || "<blank>"}${title ? ` (${title})` : ""}; readyState=${diagnostics.readyState}; ${reason}. Open pages: ${formatInspectablePages(pages)}`,
    );
  }
}

export async function disconnectBrowser(page) {
  try {
    const cleanup = browserCleanupByPage.get(page);
    if (cleanup) {
      browserCleanupByPage.delete(page);
      await cleanup();
      return;
    }

    await page.context().browser()?.close();
  } catch {
    // Ignore disconnect errors — the browser may already be closed.
  }
}
