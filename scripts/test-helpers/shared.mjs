/* global window */

import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CORE_DEBUG_GLOBAL_NAMES, DEBUG_EDITOR_TEST_ID } from "../../src/debug/debug-bridge-contract.js";

export const DEFAULT_PORT = 9322;
export const DEFAULT_APP_URL = "http://localhost:5173";
export const DEFAULT_BROWSER_MODE = "cdp";
export const DEFAULT_MANAGED_VIEWPORT = { width: 1280, height: 900 };
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
export const REPO_DEMO_ROOT = resolve(REPO_ROOT, "demo");
export const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, "fixtures");
export const PUBLIC_SHOWCASE_FIXTURE = {
  displayPath: "demo/index.md",
  virtualPath: "index.md",
  candidates: [
    resolve(REPO_ROOT, "demo/index.md"),
  ],
};
export const MODE_LABELS = {
  lexical: "Lexical",
  read: "Read",
  source: "Source",
};
export const TEXT_FIXTURE_EXTENSIONS = new Set([
  ".bib",
  ".csl",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

export function formatInspectablePages(pages) {
  if (pages.length === 0) return "<none>";
  return pages
    .map((page) => `[${page.contextIndex}:${page.pageIndex}] ${page.url || "<blank>"} score=${page.score}`)
    .join(" | ");
}

export async function pageHasDebugBridge(page) {
  return page.evaluate(
    ({ coreGlobals }) => coreGlobals.every((name) => Boolean(window[name])),
    { coreGlobals: CORE_DEBUG_GLOBAL_NAMES },
  ).catch(() => false);
}

export async function waitForEditorSurface(page, timeout = 10000) {
  await page.waitForFunction(
    ({ editorTestId }) => Boolean(window.__editor && document.querySelector(`[data-testid="${editorTestId}"]`)),
    { editorTestId: DEBUG_EDITOR_TEST_ID },
    { timeout },
  );
}

export function sleep(ms) {
  return delay(ms);
}
