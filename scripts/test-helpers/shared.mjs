/* global window */

import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  EDITOR_MODE,
  EDITOR_MODE_LABELS,
  LEGACY_EDITOR_MODE_READ,
  markdownEditorModes,
  normalizeEditorModeInput,
  REVEAL_PRESENTATION,
  revealPresentations,
} from "../../src/app/editor-mode-contract.js";
import {
  isWindowStateStorageKey,
  SETTINGS_KEY,
  WINDOW_STATE_KEY,
  WINDOW_STATE_SCOPED_PREFIX,
} from "../../src/constants/storage-keys-contract.js";
import {
  CORE_DEBUG_GLOBAL_NAMES,
  DEBUG_EDITOR_SELECTOR,
  DEBUG_EDITOR_TEST_ID,
  MODE_BUTTON_SELECTOR,
  MODE_BUTTON_TEST_ID,
} from "../../src/debug/debug-bridge-contract.js";

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
export {
  DEBUG_EDITOR_SELECTOR,
  DEBUG_EDITOR_TEST_ID,
  EDITOR_MODE,
  EDITOR_MODE_LABELS as MODE_LABELS,
  LEGACY_EDITOR_MODE_READ,
  MODE_BUTTON_SELECTOR,
  MODE_BUTTON_TEST_ID,
  REVEAL_PRESENTATION,
  SETTINGS_KEY,
  WINDOW_STATE_KEY,
  WINDOW_STATE_SCOPED_PREFIX,
  isWindowStateStorageKey,
  markdownEditorModes,
  normalizeEditorModeInput,
  revealPresentations,
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

export function formatEditorModeUsage() {
  return `${markdownEditorModes.join(", ")} (legacy alias: ${LEGACY_EDITOR_MODE_READ})`;
}

export function normalizeAutomationMode(mode) {
  const normalized = normalizeEditorModeInput(mode);
  if (!normalized) {
    throw new Error(`Unsupported mode "${mode}". Use ${formatEditorModeUsage()}.`);
  }
  return normalized;
}

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
    ({ editorSelector }) => Boolean(window.__editor && document.querySelector(editorSelector)),
    { editorSelector: DEBUG_EDITOR_SELECTOR },
    { timeout },
  );
}

export function sleep(ms) {
  return delay(ms);
}
