import { chromium } from "playwright";
import { waitForDebugBridge } from "./browser-lifecycle.mjs";

/**
 * Take a screenshot.
 *
 * Chrome 145's CDP has a headed-mode bug where Page.captureScreenshot
 * hangs indefinitely. If the default page.screenshot() times out, we
 * launch a temporary headless browser, navigate to the same URL, and
 * capture there. The headless instance won't have app state (editor
 * content, scroll position) so this is a last-resort fallback.
 *
 * Prefer running Chrome in headless mode (`--headless=new`) when
 * screenshots are needed. See CLAUDE.md "Browser testing" section.
 */
export async function screenshot(page, path, options = {}) {
  const resolvedPath = typeof path === "string" ? path : undefined;
  const resolvedOptions = typeof path === "string" ? options : path ?? {};
  const {
    fallback = Boolean(resolvedPath),
    timeout = 5000,
    ...screenshotOptions
  } = resolvedOptions;
  const captureOptions = resolvedPath
    ? { path: resolvedPath, timeout, ...screenshotOptions }
    : { timeout, ...screenshotOptions };

  try {
    return await withTimeout(
      page.screenshot(captureOptions),
      timeout,
      `Screenshot timed out after ${timeout}ms`,
    );
  } catch (error) {
    if (!fallback) {
      throw error;
    }
    return captureScreenshotFallback(page, captureOptions, timeout, error);
  }
}

async function withTimeout(promise, timeout, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeout);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function captureScreenshotFallback(page, captureOptions, timeout, cause) {
  const url = page.url();
  const viewport = page.viewportSize();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(viewport ? { viewport } : {});
    const fallbackPage = await context.newPage();
    fallbackPage.setDefaultTimeout(timeout);
    await fallbackPage.goto(url, { waitUntil: "domcontentloaded", timeout });
    await waitForDebugBridge(fallbackPage, { timeout }).catch(() => {});
    return await fallbackPage.screenshot(captureOptions);
  } catch (fallbackError) {
    throw new Error(
      `Screenshot failed (${cause instanceof Error ? cause.message : String(cause)}); fallback failed (${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)})`,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}
