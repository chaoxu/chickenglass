/* global window */
/**
 * Playwright test helpers for CDP-based browser testing.
 *
 * Usage:
 *   import { connectEditor, openFile, getTreeDivs, checkFences, dump } from "./test-helpers.mjs";
 *
 *   const page = await connectEditor();
 *   await openFile(page, "test-features.md");
 *   console.log(await getTreeDivs(page));
 *   console.log(await checkFences(page, [73, 77, 88]));
 *   console.log(await dump(page));
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findAppPage, inspectBrowserPages } from "./chrome-common.mjs";
import {
  DEBUG_EDITOR_SELECTOR,
  MODE_BUTTON_SELECTOR,
} from "../src/debug/debug-bridge-contract.js";

export { DEBUG_EDITOR_SELECTOR, MODE_BUTTON_SELECTOR };

const DEFAULT_PORT = 9322;
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_BROWSER_MODE = "cdp";
const DEFAULT_MANAGED_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_FIXTURE_OPEN_TIMEOUT_MS = 10000;
const DEFAULT_FIXTURE_SETTLE_MS = 200;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_DEMO_ROOT = resolve(REPO_ROOT, "demo");
const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, "fixtures");
export const EXTERNAL_DEMO_ROOT = "/Users/chaoxu/playground/coflat/demo";
export const EXTERNAL_FIXTURE_ROOT = "/Users/chaoxu/playground/coflat/fixtures";
export const PUBLIC_SHOWCASE_FIXTURE = {
  displayPath: "demo/index.md",
  virtualPath: "index.md",
  candidates: [
    resolve(REPO_ROOT, "demo/index.md"),
    resolve(EXTERNAL_DEMO_ROOT, "index.md"),
  ],
};
const MODE_LABELS = {
  "cm6-rich": "CM6 Rich",
  lexical: "Lexical",
  rich: "CM6 Rich",
  source: "Source",
};
const TEXT_FIXTURE_EXTENSIONS = new Set([
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
const fixtureProjectPayloadCache = new Map();

function formatInspectablePages(pages) {
  if (pages.length === 0) return "<none>";
  return pages
    .map((page) => `[${page.contextIndex}:${page.pageIndex}] ${page.url || "<blank>"} score=${page.score}`)
    .join(" | ");
}

async function pageHasDebugBridge(page) {
  return page.evaluate(
    () => Boolean(
      window.__app
        && window.__editor
        && window.__cfDebug
        && (window.__cmView || document.querySelector("[data-testid='lexical-editor']")),
    ),
  ).catch(() => false);
}

/** Promise-based sleep. */
export function sleep(ms) {
  return delay(ms);
}

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

export function isLoopbackAppUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
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
  } catch {
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

/**
 * Focus the editor and place the selection at the end of the document.
 *
 * @param {import("playwright").Page} page
 */
export async function focusEditorEnd(page) {
  await page.evaluate(() => {
    if (window.__editor) {
      const doc = window.__editor.getDoc();
      window.__editor.focus();
      window.__editor.setSelection(doc.length);
      return;
    }
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await sleep(100);
}

/**
 * Read the full raw editor document text.
 *
 * @param {import("playwright").Page} page
 */
export async function readEditorText(page) {
  return page.evaluate(() =>
    window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString()
  );
}

/**
 * Apply an editor formatting command through the product-neutral debug bridge.
 *
 * @param {import("playwright").Page} page
 * @param {import("../src/constants/events").FormatEventDetail} detail
 */
export async function formatSelection(page, detail) {
  const handled = await page.evaluate((nextDetail) => (
    window.__editor?.formatSelection?.(nextDetail) ?? false
  ), detail);
  if (!handled) {
    throw new Error(`formatSelection was not handled: ${JSON.stringify(detail)}`);
  }
  await sleep(150);
}

/**
 * Save the current document through the app debug bridge.
 *
 * @param {import("playwright").Page} page
 */
export async function saveCurrentFile(page) {
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await sleep(150);
}

/**
 * Discard the currently open document without prompting.
 *
 * @param {import("playwright").Page} page
 */
export async function discardCurrentFile(page) {
  const discarded = await page.evaluate(async () => {
    const app = window.__app;
    if (!app?.closeFile) {
      return false;
    }
    if (!app.getCurrentDocument?.()) {
      return true;
    }
    const closed = await app.closeFile({ discard: true });
    if (closed) {
      return true;
    }
    return !app.getCurrentDocument?.();
  });
  await sleep(150);
  return discarded;
}

/**
 * Open a file by path (e.g. "posts/2014-11-04-isotonic-....md").
 * Uses the app's real openFile function via window.__app.
 */
export async function openFile(page, path) {
  try {
    await page.evaluate((p) => window.__app.openFile(p), path);
    await sleep(500);
    return;
  } catch (error) {
    if (!hasFixtureDocument(path)) {
      throw error;
    }
  }

  await openFixtureDocument(page, path, {
    discardCurrent: false,
    project: "full-project",
  });
}

function defaultFixtureCandidates(path) {
  return [
    resolve(REPO_DEMO_ROOT, path),
    resolve(REPO_FIXTURE_ROOT, path),
    resolve(EXTERNAL_DEMO_ROOT, path),
    resolve(EXTERNAL_FIXTURE_ROOT, path),
  ];
}

function inferFixtureDisplayPath(virtualPath, resolvedPath) {
  if (!resolvedPath) return `fixture:${virtualPath}`;
  if (
    resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`) ||
    resolvedPath.startsWith(`${EXTERNAL_DEMO_ROOT}/`)
  ) {
    return `demo/${virtualPath}`;
  }
  if (
    resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`) ||
    resolvedPath.startsWith(`${EXTERNAL_FIXTURE_ROOT}/`)
  ) {
    return `fixtures/${virtualPath}`;
  }
  return `fixture:${virtualPath}`;
}

function fixtureRootForResolvedPath(resolvedPath) {
  if (resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`)) return REPO_DEMO_ROOT;
  if (resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`)) return REPO_FIXTURE_ROOT;
  if (resolvedPath.startsWith(`${EXTERNAL_DEMO_ROOT}/`)) return EXTERNAL_DEMO_ROOT;
  if (resolvedPath.startsWith(`${EXTERNAL_FIXTURE_ROOT}/`)) return EXTERNAL_FIXTURE_ROOT;
  return null;
}

function inferFixtureProjectPrefix(virtualPath) {
  const slashIndex = virtualPath.indexOf("/");
  return slashIndex >= 0 ? virtualPath.slice(0, slashIndex) : null;
}

function buildFixtureProjectPayload(virtualPath, resolvedPath) {
  const root = fixtureRootForResolvedPath(resolvedPath);
  const projectPrefix = inferFixtureProjectPrefix(virtualPath);
  if (!root) {
    return null;
  }

  const projectRoot = projectPrefix ? resolve(root, projectPrefix) : root;
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    return null;
  }

  const cacheKey = `${projectRoot}:${projectPrefix ?? ""}`;
  const cached = fixtureProjectPayloadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  /** @type {Array<
   *   { path: string, kind: "text", content: string } |
   *   { path: string, kind: "binary", base64: string }
   * >} */
  const files = [];
  const fingerprintParts = [];

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const repoRelativePath = relative(root, absolutePath).replace(/\\/g, "/");
      const stat = statSync(absolutePath);
      fingerprintParts.push(`${repoRelativePath}:${stat.size}:${stat.mtimeMs}`);
      const extension = extname(entry.name).toLowerCase();
      if (TEXT_FIXTURE_EXTENSIONS.has(extension)) {
        files.push({
          path: repoRelativePath,
          kind: "text",
          content: readFileSync(absolutePath, "utf8"),
        });
        continue;
      }

      files.push({
        path: repoRelativePath,
        kind: "binary",
        base64: readFileSync(absolutePath).toString("base64"),
      });
    }
  };

  visit(projectRoot);
  const payload = {
    key: `${cacheKey}:${fingerprintParts.sort().join("|")}`,
    files,
  };
  fixtureProjectPayloadCache.set(cacheKey, payload);
  return payload;
}

function isMissingFixtureError(error) {
  return error instanceof Error && error.message.startsWith("Missing fixture for ");
}

/**
 * Resolve a browser regression fixture from the repo demo tree or the external
 * demo root used by the perf harness.
 *
 * @param {string | {
 *   virtualPath: string,
 *   displayPath?: string,
 *   candidates?: string[],
 *   content?: string,
 * }} fixture
 */
export function resolveFixtureDocument(fixture) {
  const normalized = typeof fixture === "string"
    ? {
        virtualPath: fixture,
      }
    : {
        ...fixture,
      };
  const explicitDisplayPath = typeof fixture === "string"
    ? undefined
    : fixture.displayPath;
  const fallbackDisplayPath = explicitDisplayPath ?? `fixture:${normalized.virtualPath}`;

  if (typeof normalized.content === "string") {
    return {
      ...normalized,
      displayPath: fallbackDisplayPath,
      resolvedPath: normalized.resolvedPath ?? null,
      content: normalized.content,
      candidates: normalized.candidates ?? defaultFixtureCandidates(normalized.virtualPath),
    };
  }

  const candidates = normalized.candidates ?? defaultFixtureCandidates(normalized.virtualPath);
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(
      `Missing fixture for ${fallbackDisplayPath}. Tried: ${candidates.join(", ")}`,
    );
  }

  return {
    ...normalized,
    displayPath: explicitDisplayPath ?? inferFixtureDisplayPath(normalized.virtualPath, resolvedPath),
    resolvedPath,
    content: readFileSync(resolvedPath, "utf8"),
    candidates,
  };
}

export function hasFixtureDocument(fixture) {
  try {
    resolveFixtureDocument(fixture);
    return true;
  } catch (error) {
    if (isMissingFixtureError(error)) {
      return false;
    }
    throw error;
  }
}

export function resolveFixtureDocumentWithFallback(
  fixture,
  fallbackFixture = PUBLIC_SHOWCASE_FIXTURE,
) {
  try {
    return resolveFixtureDocument(fixture);
  } catch (error) {
    if (!isMissingFixtureError(error)) {
      throw error;
    }
    return resolveFixtureDocument(fallbackFixture);
  }
}

/**
 * Open a fixture deterministically. Prefer the app's real `openFile()` path
 * when it resolves to the expected content, otherwise fall back to
 * `openFileWithContent()` so heavy external fixtures remain reproducible.
 *
 * @param {import("playwright").Page} page
 * @param {string | {
 *   virtualPath: string,
 *   displayPath?: string,
 *   candidates?: string[],
 *   content?: string,
 * }} fixture
 * @param {{
 *   mode?: "rich" | "cm6-rich" | "lexical" | "source",
 *   discardCurrent?: boolean,
 *   project?: "single-file" | "full-project",
 *   timeoutMs?: number,
 *   settleMs?: number,
 * }} [options]
 */
export async function openFixtureDocument(page, fixture, options = {}) {
  const resolved = resolveFixtureDocument(fixture);
  const {
    mode,
    discardCurrent = true,
    project = "single-file",
    timeoutMs = DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
    settleMs = DEFAULT_FIXTURE_SETTLE_MS,
  } = options;
  const preferOpenFile = Boolean(
    resolved.resolvedPath?.startsWith(resolve(REPO_ROOT, "demo")),
  );
  const projectPayload = project === "full-project" && resolved.resolvedPath
    ? buildFixtureProjectPayload(resolved.virtualPath, resolved.resolvedPath)
    : null;
  const verificationWindow = 200;

  if (discardCurrent) {
    await discardCurrentFile(page).catch(() => false);
  }

  const result = await page.evaluate(
    async ({
      path,
      expectedContent,
      expectedLength,
      expectedPrefix,
      expectedSuffix,
      tryOpenFileFirst,
      fixtureProjectPayload,
    }) => {
      const app = window.__app;
      if (!app?.openFile) {
        throw new Error("window.__app.openFile is unavailable.");
      }

      const currentDocumentMatches = () => {
        const text = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString();
        return typeof text === "string" &&
          text.length === expectedLength &&
          text.startsWith(expectedPrefix) &&
          text.endsWith(expectedSuffix);
      };

      if (fixtureProjectPayload && app.loadFixtureProject) {
        const cachedProject = window.__coflatFixtureProject;
        const hasCachedFile = cachedProject?.key === fixtureProjectPayload.key &&
          (app.hasFile ? await app.hasFile(path) : false);
        if (hasCachedFile) {
          await app.openFile(path);
          if (currentDocumentMatches()) {
            return { method: "openFileCachedProject" };
          }
        }

        await app.loadFixtureProject(fixtureProjectPayload.files, path);
        window.__coflatFixtureProject = { key: fixtureProjectPayload.key };
        return { method: "loadFixtureProject" };
      }

      const canOpenInCurrentProject = tryOpenFileFirst
        || (app.hasFile ? await app.hasFile(path) : false);

      if (canOpenInCurrentProject) {
        try {
          await app.openFile(path);
          return { method: "openFile" };
        } catch (error) {
          if (!app.openFileWithContent) {
            throw error;
          }
        }
      }

      if (!app.openFileWithContent) {
        throw new Error(`window.__app.openFileWithContent is unavailable while opening ${path}.`);
      }

      await app.openFileWithContent(path, expectedContent);
      return { method: "openFileWithContent" };
    },
    {
      path: resolved.virtualPath,
      expectedContent: resolved.content,
      expectedLength: resolved.content.length,
      expectedPrefix: resolved.content.slice(0, verificationWindow),
      expectedSuffix: resolved.content.slice(-verificationWindow),
      tryOpenFileFirst: preferOpenFile,
      fixtureProjectPayload: projectPayload,
    },
  );

  try {
    await page.waitForFunction(
      ({ method, path, expectedLength, expectedPrefix, expectedSuffix }) => {
        const text = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString();
        const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
        if (typeof text !== "string" || currentPath !== path) {
          return false;
        }

        if (
          method === "openFileWithContent" ||
          method === "loadFixtureProject" ||
          method === "openFileCachedProject"
        ) {
          return text.length === expectedLength &&
            text.startsWith(expectedPrefix) &&
            text.endsWith(expectedSuffix);
        }

        return text.length > 0;
      },
      {
        method: result.method,
        path: resolved.virtualPath,
        expectedLength: resolved.content.length,
        expectedPrefix: resolved.content.slice(0, verificationWindow),
        expectedSuffix: resolved.content.slice(-verificationWindow),
      },
      { timeout: timeoutMs, polling: 100 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(
      ({ expectedPrefix, expectedSuffix }) => {
        const text = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString();
        const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
        return {
          currentPath,
          docLength: typeof text === "string" ? text.length : null,
          prefixMatches: typeof text === "string" ? text.startsWith(expectedPrefix) : false,
          suffixMatches: typeof text === "string" ? text.endsWith(expectedSuffix) : false,
        };
      },
      {
        expectedPrefix: resolved.content.slice(0, verificationWindow),
        expectedSuffix: resolved.content.slice(-verificationWindow),
      },
    ).catch((evaluateError) => ({
      evaluateError: evaluateError instanceof Error ? evaluateError.message : String(evaluateError),
    }));

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Timed out opening fixture ${resolved.displayPath} via ${result.method}: ${message}; diagnostics=${JSON.stringify(diagnostics)}`,
    );
  }
  if (mode) {
    await switchToMode(page, mode);
  }
  await sleep(settleMs);

  return {
    ...resolved,
    method: result.method,
  };
}

/**
 * Open a stable fixture for browser regression tests.
 *
 * Default the shared browser regression lane to the public showcase document.
 * Private heavy fixtures are loaded explicitly by the tests that need them.
 */
export async function openRegressionDocument(page, path = "index.md") {
  const opened = await openFixtureDocument(page, path, { project: "full-project" });
  return opened.virtualPath;
}

/**
 * Find the first line number whose raw text contains `needle`.
 */
export async function findLine(page, needle) {
  return page.evaluate((text) => {
    const docText = window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString();
    const lines = docText.split("\n");
    for (let line = 1; line <= lines.length; line += 1) {
      if (lines[line - 1].includes(text)) {
        return line;
      }
    }
    return -1;
  }, needle);
}

/**
 * Resolve the nth occurrence of `needle` in the document, returning the
 * document anchor plus 1-based line/column coordinates.
 */
export function resolveTextAnchorInDocument(
  documentText,
  needle,
  { occurrence = 1, offset = 0 } = {},
) {
  if (typeof needle !== "string" || needle.length === 0) {
    throw new Error("Text anchor needle must be a non-empty string.");
  }
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`Text anchor occurrence must be a positive integer; got ${occurrence}.`);
  }
  if (!Number.isInteger(offset)) {
    throw new Error(`Text anchor offset must be an integer; got ${offset}.`);
  }

  const lines = documentText.split("\n");
  let lineStart = 0;
  let seen = 0;

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const lineText = lines[lineNumber - 1];
    let searchFrom = 0;

    while (searchFrom <= lineText.length) {
      const matchIndex = lineText.indexOf(needle, searchFrom);
      if (matchIndex < 0) {
        break;
      }

      seen += 1;
      if (seen === occurrence) {
        const lineEnd = lineStart + lineText.length;
        const anchor = Math.max(
          lineStart,
          Math.min(lineEnd, lineStart + matchIndex + offset),
        );

        return {
          line: lineNumber,
          col: anchor - lineStart + 1,
          anchor,
        };
      }

      searchFrom = matchIndex + needle.length;
    }

    lineStart += lineText.length + 1;
  }

  return null;
}

/**
 * Jump to the nth occurrence of `needle`, placing the cursor at the matched
 * text plus an optional character offset.
 */
export async function jumpToTextAnchor(
  page,
  needle,
  { occurrence = 1, offset = 0 } = {},
) {
  const documentText = await page.evaluate(() =>
    window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString()
  );
  const result = resolveTextAnchorInDocument(documentText, needle, {
    occurrence,
    offset,
  });

  if (!result) {
    throw new Error(`Failed to find text anchor ${JSON.stringify(needle)} (occurrence ${occurrence}).`);
  }

  await page.evaluate(({ anchor }) => {
    if (window.__editor) {
      window.__editor.focus();
      window.__editor.setSelection(anchor);
      return;
    }
    const view = window.__cmView;
    view.focus();
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
  }, { anchor: result.anchor });

  await sleep(200);
  return result;
}

/**
 * Cycle the editor mode button until the requested mode is active.
 *
 * @param {import("playwright").Page} page
 * @param {"rich" | "cm6-rich" | "lexical" | "source" | "CM6 Rich" | "Lexical" | "Source"} mode
 */
export async function switchToMode(page, mode) {
  const normalizedMode = mode === "Rich" || mode === "CM6 Rich" || mode === "rich"
    ? "cm6-rich"
    : mode === "Lexical"
      ? "lexical"
      : mode === "Source"
        ? "source"
        : mode;
  const targetLabel = MODE_LABELS[normalizedMode] ?? normalizedMode;

  const changedViaApp = await page.evaluate(async (nextMode) => {
    if (!window.__app?.setMode || !window.__app?.getMode) {
      return null;
    }
    window.__app.setMode(nextMode);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return window.__app.getMode();
  }, normalizedMode);

  if (changedViaApp !== null) {
    if (changedViaApp !== normalizedMode) {
      throw new Error(`Failed to switch editor mode to ${normalizedMode}; current mode is ${changedViaApp}.`);
    }
    await sleep(200);
    return;
  }

  const modeButton = page.getByTestId("mode-button");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentLabel = (await modeButton.textContent())?.trim();
    if (currentLabel === targetLabel) return;
    await modeButton.click();
    await sleep(200);
  }

  const finalLabel = (await modeButton.textContent())?.trim();
  throw new Error(`Failed to switch editor mode to ${targetLabel}; current mode is ${finalLabel ?? "<unknown>"}.`);
}

/**
 * Open the app-level search panel and wait for its input to appear.
 *
 * @param {import("playwright").Page} page
 */
export async function openAppSearch(page) {
  await page.evaluate(() => {
    window.__app.setSearchOpen(true);
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector('[role="dialog"] input')),
    { timeout: 5000 },
  );
  await sleep(150);
}

/**
 * Click the first visible search-dialog result button containing `needle`.
 *
 * @param {import("playwright").Page} page
 * @param {string} needle
 */
export async function clickSearchDialogResult(page, needle) {
  const clicked = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((candidate) =>
      (candidate.textContent ?? "").includes(text));
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }
    button.click();
    return true;
  }, needle);

  if (!clicked) {
    throw new Error(`failed to click search result containing ${JSON.stringify(needle)}`);
  }
}
/**
 * Close the app-level search panel if it is open.
 *
 * @param {import("playwright").Page} page
 */
export async function closeAppSearch(page) {
  const isOpen = await page.evaluate(
    () => Boolean(document.querySelector('[role="dialog"] input')),
  );
  if (!isOpen) {
    return;
  }
  await page.evaluate(() => {
    window.__app.setSearchOpen(false);
  });
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"] input'),
    { timeout: 5000 },
  );
  await sleep(100);
}

/**
 * Wait for the CM6 autocomplete popup to render at least one option.
 *
 * @param {import("playwright").Page} page
 */
export async function waitForAutocomplete(page) {
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-tooltip-autocomplete li").length > 0,
    undefined,
    { timeout: 5000 },
  );
  await sleep(100);
}

/**
 * Read the visible CM6 autocomplete labels.
 *
 * @param {import("playwright").Page} page
 */
export async function readAutocompleteOptions(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".cm-tooltip-autocomplete li")]
      .map((item) => item.textContent?.trim() ?? "")
      .filter(Boolean),
  );
}

/**
 * Insert text into the active CM6 selection using a typed-input userEvent.
 *
 * @param {import("playwright").Page} page
 * @param {string} text
 */
export async function insertEditorText(page, text) {
  await page.evaluate((insertText) => {
    const view = window.__cmView;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      userEvent: "input.type",
    });
  }, text);
  await sleep(100);
}

/**
 * Replace the full editor document text and place the cursor at the end.
 *
 * @param {import("playwright").Page} page
 * @param {string} text
 */
export async function replaceEditorText(page, text) {
  await page.evaluate((nextText) => {
    const view = window.__cmView;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextText },
      selection: { anchor: nextText.length },
      userEvent: "input.type",
    });
  }, text);
  await sleep(100);
}

/**
 * Run a block that mutates a fixture document, then restore the fixture in a
 * `finally` block so later browser regressions see pristine demo content.
 *
 * @param {import("playwright").Page} page
 * @param {{ path: string, content: string }} fixture
 * @param {() => Promise<unknown>} run
 */
export async function withRestoredFixture(page, fixture, run) {
  let result;
  let runError = null;

  try {
    result = await run();
  } catch (error) {
    runError = error;
  }

  try {
    await openFile(page, fixture.path);
    await switchToMode(page, "source");
    await replaceEditorText(page, fixture.content);
    await saveCurrentFile(page);
  } catch (restoreError) {
    if (runError instanceof Error) {
      throw new Error(
        `${runError.message}\nfixture restore failed for ${fixture.path}: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
    throw restoreError;
  }

  if (runError) {
    throw runError;
  }

  return result;
}
/**
 * Pick a CM6 autocomplete option by substring match.
 *
 * @param {import("playwright").Page} page
 * @param {string} needle
 */
export async function pickAutocompleteOption(page, needle) {
  const picked = await page.evaluate((matchText) => {
    const option = [...document.querySelectorAll(".cm-tooltip-autocomplete li")]
      .find((item) => (item.textContent ?? "").includes(matchText));
    if (!(option instanceof HTMLElement)) {
      return false;
    }
    for (const type of ["mousedown", "mouseup", "click"]) {
      option.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
    return true;
  }, needle);
  if (!picked) {
    throw new Error(`Failed to pick autocomplete option matching ${JSON.stringify(needle)}`);
  }
  await sleep(100);
}

/**
 * Trigger a hover-preview tooltip for a rendered reference/citation selector.
 *
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
export async function showHoverPreview(page, selector) {
  const found = await page.evaluate((css) => {
    const target = document.querySelector(css);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    target.dispatchEvent(new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    return true;
  }, selector);

  if (!found) {
    throw new Error(`Failed to find hover target for selector ${JSON.stringify(selector)}`);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const visible = await page.evaluate(() => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return tooltip instanceof HTMLElement &&
        tooltip.style.display !== "none" &&
        tooltip.childElementCount > 0;
    });
    if (visible) {
      await sleep(100);
      return;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for hover preview for selector ${JSON.stringify(selector)}`);
}

/**
 * Hide the hover-preview tooltip by dispatching mouseout on the same selector.
 *
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
export async function hideHoverPreview(page, selector) {
  await page.evaluate((css) => {
    const target = document.querySelector(css);
    if (!(target instanceof HTMLElement)) {
      return;
    }
    target.dispatchEvent(new MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      view: window,
      relatedTarget: null,
    }));
  }, selector);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hidden = await page.evaluate(() => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return !(tooltip instanceof HTMLElement) || tooltip.style.display === "none";
    });
    if (hidden) {
      await sleep(100);
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out hiding hover preview for selector ${JSON.stringify(selector)}`);
}

/**
 * Read the currently visible hover-preview tooltip state.
 *
 * @param {import("playwright").Page} page
 */
export async function readHoverPreviewState(page) {
  return page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip");
    if (!(tooltip instanceof HTMLElement) || tooltip.style.display === "none") {
      return null;
    }
    return {
      text: tooltip.textContent ?? "",
      hasTable: Boolean(tooltip.querySelector(".cf-block-table table")),
      hasCaption: Boolean(tooltip.querySelector(".cf-block-caption")),
      captionText: tooltip.querySelector(".cf-block-caption")?.textContent ?? "",
      imageSrc: tooltip.querySelector(".cf-block-figure img")?.getAttribute("src") ?? null,
    };
  });
}

/**
 * Poll until the visible hover-preview tooltip satisfies `predicate`.
 *
 * @param {import("playwright").Page} page
 * @param {(state: {
 *   text: string,
 *   hasTable: boolean,
 *   hasCaption: boolean,
 *   captionText: string,
 *   imageSrc: string | null,
 * }) => boolean} predicate
 * @param {number} [timeoutMs=5000]
 */
export async function waitForHoverPreviewState(page, predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tooltip = await readHoverPreviewState(page);
    if (tooltip && predicate(tooltip)) {
      return tooltip;
    }
    await sleep(200);
  }
  return readHoverPreviewState(page);
}
/**
 * Return FencedDiv nodes from the current Lezer syntax tree.
 * Requires `__cmDebug` to be wired up (see use-editor.ts).
 */
export async function getTreeDivs(page) {
  return page.evaluate(() => window.__cmDebug.tree());
}

/**
 * Check visibility of closing fence lines.
 * Returns an array of { line, visible, height, classes } objects.
 *
 * @param {import("playwright").Page} page
 * @param {number[]} lineNumbers - line numbers to check (e.g. [73, 77, 88])
 */
export async function checkFences(page, lineNumbers) {
  return page.evaluate((lines) => {
    return lines.map((ln) => {
      const info = window.__cmDebug.line(ln);
      if (!info) return { line: ln, visible: null, height: "no-el", classes: [], found: false };
      const { height, hidden, classes } = info;
      return { line: ln, visible: !hidden, height, classes, found: true };
    });
  }, lineNumbers);
}

/**
 * Return a full debug snapshot: tree divs, fence status, cursor position.
 */
export async function dump(page) {
  return page.evaluate(() => window.__cmDebug.dump());
}

/**
 * Return the compact visible rich-render snapshot.
 */
export async function getRenderState(page) {
  return page.evaluate(() => window.__cmDebug.renderState());
}

/**
 * Return the current debug session recorder status.
 */
export async function getRecorderStatus(page) {
  return page.evaluate(() => window.__cfDebug.recorderStatus());
}

/**
 * Capture the current combined debug state and record it in the session log.
 */
export async function captureDebugState(page, label = null) {
  return page.evaluate((snapshotLabel) => window.__cfDebug.captureState(snapshotLabel), label);
}

/**
 * Return the current measured geometry snapshot for visible lines and shell surfaces.
 */
export async function getGeometrySnapshot(page) {
  return page.evaluate(() => window.__cmDebug.geometry());
}

/**
 * Return the active explicit structure-edit target, if any.
 */
export async function getStructureState(page) {
  return page.evaluate(() => window.__cmDebug.structure());
}

/**
 * Activate structure editing for the block/frontmatter at the current cursor.
 */
export async function activateStructureAtCursor(page) {
  const activated = await page.evaluate(() => window.__cmDebug.activateStructureAtCursor());
  await sleep(150);
  return activated;
}

/**
 * Clear the active explicit structure-edit target.
 */
export async function clearStructure(page) {
  const cleared = await page.evaluate(() => window.__cmDebug.clearStructure());
  await sleep(150);
  return cleared;
}

/**
 * Return recent vertical-motion guard events captured by the editor.
 */
export async function getMotionGuards(page) {
  return page.evaluate(() => window.__cmDebug.motionGuards());
}

/**
 * Clear recent vertical-motion guard events.
 */
export async function clearMotionGuards(page) {
  await page.evaluate(() => window.__cmDebug.clearMotionGuards());
  await sleep(50);
}

/**
 * Place cursor at a specific line and column, with focus.
 */
export async function setCursor(page, line, col = 0) {
  await page.evaluate(
    ({ line, col }) => {
      const view = window.__cmView;
      view.focus();
      const lines = view.state.doc.toString().split("\n");
      const clampedLine = Math.max(1, Math.min(line, lines.length));
      let anchor = 0;
      for (let index = 0; index < clampedLine - 1; index += 1) {
        anchor += lines[index].length + 1;
      }
      const lineText = lines[clampedLine - 1] ?? "";
      anchor += Math.max(0, Math.min(col, lineText.length));
      view.dispatch({ selection: { anchor } });
    },
    { line, col },
  );
  await sleep(200);
}

/**
 * Scroll the editor to show a specific line near the top.
 */
export async function scrollTo(page, line) {
  await page.evaluate((ln) => {
    const view = window.__cmView;
    view.focus();
    const lines = view.state.doc.toString().split("\n");
    const clampedLine = Math.max(1, Math.min(ln, lines.length));
    let anchor = 0;
    for (let index = 0; index < clampedLine - 1; index += 1) {
      anchor += lines[index].length + 1;
    }
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
    const coords = view.coordsAtPos(anchor, 1) ?? view.coordsAtPos(anchor, -1);
    if (!coords) return;
    const rect = view.scrollDOM.getBoundingClientRect();
    const targetTop = rect.top + Math.min(120, view.scrollDOM.clientHeight / 3);
    view.scrollDOM.scrollTop = Math.max(
      0,
      view.scrollDOM.scrollTop + coords.top - targetTop,
    );
  }, line);
  await sleep(400);
}

/**
 * Scroll the editor so the first line containing `needle` is visible.
 */
export async function scrollToText(page, needle) {
  const line = await findLine(page, needle);
  if (line < 0) {
    throw new Error(`Missing line containing "${needle}"`);
  }
  await scrollTo(page, line);
  return line;
}

/**
 * Wait for selection-driven layout and scroll effects to settle.
 *
 * @param {import("playwright").Page} page
 * @param {{ frameCount?: number, delayMs?: number }} [options]
 */
export async function settleEditorLayout(page, options = {}) {
  const frameCount = Math.max(1, options.frameCount ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 32);
  await page.evaluate(async ({ nextFrameCount, nextDelayMs }) => {
    const waitForFrame = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timeoutId = setTimeout(finish, 50);
        requestAnimationFrame(() => {
          clearTimeout(timeoutId);
          finish();
        });
      });
    for (let frame = 0; frame < nextFrameCount; frame += 1) {
      await waitForFrame();
    }
    if (nextDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
    }
  }, {
    nextFrameCount: frameCount,
    nextDelayMs: delayMs,
  });
}

/**
 * Trace repeated vertical cursor movement in the real CM6 view.
 *
 * Records logical cursor position, line text, scrollTop, cursor coordinates,
 * and nearby line context at each step so scroll anomalies can be diagnosed
 * without ad hoc throwaway scripts.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   direction?: "up" | "down",
 *   steps?: number,
 *   startLine?: number,
 *   startColumn?: number,
 *   startHead?: number,
 *   settleMs?: number,
 *   contextRadius?: number,
 * }} [options]
 */
export async function traceVerticalCursorMotion(page, options = {}) {
  return page.evaluate(async (config) => {
    const view = window.__cmView;
    const debug = window.__cmDebug;
    if (!view || !debug) {
      throw new Error("window.__cmView or window.__cmDebug is unavailable.");
    }

    const direction = config.direction === "down" ? "down" : "up";
    const steps = Math.max(0, config.steps ?? 0);
    const settleMs = Math.max(0, config.settleMs ?? 32);
    const contextRadius = Math.max(0, config.contextRadius ?? 2);

    const waitForFrame = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timeoutId = setTimeout(finish, 50);
        requestAnimationFrame(() => {
          clearTimeout(timeoutId);
          finish();
        });
      });

    const waitForSettle = async (delayOverride = settleMs) => {
      await waitForFrame();
      await waitForFrame();
      if (delayOverride > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayOverride));
      }
    };

    const clampLine = (lineNumber) =>
      Math.max(1, Math.min(lineNumber, view.state.doc.lines));
    const clampHead = (head) =>
      Math.max(0, Math.min(head, view.state.doc.length));

    const collectNearbyLines = (lineNumber) => {
      const lines = [];
      const fromLine = clampLine(lineNumber - contextRadius);
      const toLine = clampLine(lineNumber + contextRadius);
      for (let line = fromLine; line <= toLine; line += 1) {
        lines.push({
          line,
          text: view.state.doc.line(line).text,
          info: debug.line(line),
        });
      }
      return lines;
    };

    const collectStep = (step) => {
      const selection = view.state.selection.main;
      const line = view.state.doc.lineAt(selection.head);
      const coords = view.coordsAtPos(selection.head)
        ?? (selection.head > 0 ? view.coordsAtPos(selection.head - 1, 1) : null)
        ?? (selection.head < view.state.doc.length ? view.coordsAtPos(selection.head + 1, -1) : null);

      return {
        step,
        head: selection.head,
        anchor: selection.anchor,
        line: line.number,
        lineText: line.text,
        scrollTop: view.scrollDOM.scrollTop,
        cursorTop: coords?.top ?? null,
        cursorBottom: coords?.bottom ?? null,
        lineInfo: debug.line(line.number),
        nearbyLines: collectNearbyLines(line.number),
      };
    };

    const anchorCursorIntoViewport = () => {
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head)
        ?? (head > 0 ? view.coordsAtPos(head - 1, 1) : null)
        ?? (head < view.state.doc.length ? view.coordsAtPos(head + 1, -1) : null);
      if (!coords) return;
      const viewportHeight = view.scrollDOM.clientHeight || 800;
      if (coords.top < 0 || coords.bottom > viewportHeight) {
        view.scrollDOM.scrollTop = Math.max(0, coords.top - Math.min(200, viewportHeight / 3));
      }
    };

    if (typeof config.startHead === "number") {
      const head = clampHead(config.startHead);
      view.focus();
      view.dispatch({ selection: { anchor: head }, scrollIntoView: true });
    } else if (typeof config.startLine === "number") {
      const lineNumber = clampLine(config.startLine);
      const line = view.state.doc.line(lineNumber);
      const column = Math.max(0, Math.min(config.startColumn ?? 0, line.text.length));
      view.focus();
      view.dispatch({
        selection: { anchor: Math.min(line.to, line.from + column) },
        scrollIntoView: true,
      });
    } else {
      view.focus();
    }

    await waitForSettle(Math.max(settleMs, 200));
    anchorCursorIntoViewport();
    await waitForSettle(Math.max(settleMs, 50));

    const trace = [collectStep(0)];
    let stopReason = null;

    for (let step = 1; step <= steps; step += 1) {
      const moved = typeof debug.moveVertically === "function"
        ? debug.moveVertically(direction)
        : (() => {
            const previousRange = view.state.selection.main;
            const nextRange = view.moveVertically(previousRange, direction === "down");
            if (
              nextRange.anchor === previousRange.anchor &&
              nextRange.head === previousRange.head
            ) {
              return false;
            }
            view.dispatch({
              selection: view.state.selection.replaceRange(nextRange),
              scrollIntoView: true,
            });
            return true;
          })();

      if (!moved) {
        const previousRange = view.state.selection.main;
        const currentLine = view.state.doc.lineAt(previousRange.head).number;
        stopReason = currentLine === 1 && direction === "up"
          ? "top-boundary"
          : currentLine === view.state.doc.lines && direction === "down"
            ? "bottom-boundary"
            : "stalled";
        break;
      }
      await waitForSettle();
      trace.push(collectStep(step));
    }

    return {
      direction,
      trace,
      stopReason,
    };
  }, options);
}

function issueMatches(text, patterns) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));
}

/**
 * Capture runtime issues emitted during a browser scenario.
 *
 * Collects `console.error(...)` messages and uncaught page errors while the
 * callback runs, then returns both the callback result and any captured issues.
 *
 * @param {import("playwright").Page} page
 * @param {() => Promise<unknown>} run
 * @param {{
 *   ignoreConsole?: Array<string | RegExp>,
 *   ignorePageErrors?: Array<string | RegExp>,
 * }} [options]
 */
export async function withRuntimeIssueCapture(page, run, options = {}) {
  const issues = [];
  const ignoreConsole = options.ignoreConsole ?? [];
  const ignorePageErrors = options.ignorePageErrors ?? [];

  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (issueMatches(text, ignoreConsole)) return;
    issues.push({ source: "console", text });
  };

  const onPageError = (error) => {
    const text = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    if (issueMatches(text, ignorePageErrors)) return;
    issues.push({ source: "pageerror", text });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const value = await run();
    await sleep(100);
    return { value, issues };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

/**
 * Summarize a list of captured runtime issues for regression-test output.
 *
 * @param {Array<{ source: string, text: string }>} issues
 * @param {number} [limit=3]
 */
export function formatRuntimeIssues(issues, limit = 3) {
  if (issues.length === 0) return "none";
  return issues
    .slice(0, limit)
    .map((issue) => `[${issue.source}] ${issue.text}`)
    .join(" | ");
}

/**
 * Collect a generic editor/app health snapshot after a scenario step.
 *
 * The goal is to catch session-level breakage: invalid selection bounds,
 * missing debug bridge globals, duplicate transient UI surfaces, or malformed
 * semantic revision info after real user flows.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   maxVisibleDialogs?: number,
 *   maxVisibleHoverPreviews?: number,
 *   maxAutocompleteTooltips?: number,
 * }} [options]
 */
async function collectEditorHealth(page, options = {}) {
  const {
    maxVisibleDialogs = 0,
    maxVisibleHoverPreviews = 1,
    maxAutocompleteTooltips = 1,
  } = options;

  return page.evaluate((limits) => {
    const issues = [];
    const modeLabels = new Set(["cm6-rich", "lexical", "source"]);

    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((el) => isVisible(el)).length;

    const hasCmBridge = Boolean(window.__cmView && window.__cmDebug);
    if (!window.__app) issues.push("missing window.__app");
    if (!window.__editor && !hasCmBridge) issues.push("missing editor debug bridge");
    if (!window.__cfDebug) issues.push("missing window.__cfDebug");

    const view = window.__cmView;
    const mode = window.__app?.getMode?.() ?? null;
    const editorDoc = window.__editor?.getDoc?.() ?? null;
    const editorSelection = window.__editor?.getSelection?.() ?? null;
    const docLength = typeof editorDoc === "string"
      ? editorDoc.length
      : view?.state?.doc?.length ?? -1;
    const selection = editorSelection
      ? {
          anchor: editorSelection.anchor,
          head: editorSelection.focus,
        }
      : view?.state?.selection?.main
        ? {
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
          }
        : null;
    const semantics = window.__cmDebug?.semantics?.() ?? null;
    const treeString = window.__cmDebug?.treeString?.() ?? "";
    const dialogCount = visibleCount('[role="dialog"]');
    const hoverPreviewCount = visibleCount(".cf-hover-preview-tooltip");
    const autocompleteCount = visibleCount(".cm-tooltip-autocomplete");

    if (!modeLabels.has(mode)) {
      issues.push(`invalid mode: ${String(mode)}`);
    }
    if (docLength < 0) {
      issues.push(`invalid doc length: ${docLength}`);
    }
    if (selection) {
      if (selection.anchor < 0 || selection.anchor > docLength) {
        issues.push(`selection.anchor out of bounds: ${selection.anchor}/${docLength}`);
      }
      if (selection.head < 0 || selection.head > docLength) {
        issues.push(`selection.head out of bounds: ${selection.head}/${docLength}`);
      }
    } else {
      issues.push("missing main selection");
    }

    if (hasCmBridge && (!semantics || typeof semantics.revision !== "number" || Number.isNaN(semantics.revision))) {
      issues.push("invalid semantic revision info");
    }
    if (hasCmBridge && (typeof treeString !== "string" || treeString.length === 0)) {
      issues.push("missing syntax tree string");
    }
    if (dialogCount > limits.maxVisibleDialogs) {
      issues.push(`too many visible dialogs: ${dialogCount}/${limits.maxVisibleDialogs}`);
    }
    if (hoverPreviewCount > limits.maxVisibleHoverPreviews) {
      issues.push(
        `too many visible hover previews: ${hoverPreviewCount}/${limits.maxVisibleHoverPreviews}`,
      );
    }
    if (autocompleteCount > limits.maxAutocompleteTooltips) {
      issues.push(
        `too many autocomplete tooltips: ${autocompleteCount}/${limits.maxAutocompleteTooltips}`,
      );
    }

    return {
      mode,
      docLength,
      selection,
      semantics,
      treeErrorNodeCount: typeof treeString === "string" ? (treeString.match(/⚠/g) ?? []).length : 0,
      dialogCount,
      hoverPreviewCount,
      autocompleteCount,
      issues,
    };
  }, {
    maxVisibleDialogs,
    maxVisibleHoverPreviews,
    maxAutocompleteTooltips,
  });
}

/**
 * Assert that the generic editor/app health snapshot is clean.
 *
 * @param {import("playwright").Page} page
 * @param {string} label
 * @param {{
 *   maxVisibleDialogs?: number,
 *   maxVisibleHoverPreviews?: number,
 *   maxAutocompleteTooltips?: number,
 * }} [options]
 */
export async function assertEditorHealth(page, label, options = {}) {
  const health = await collectEditorHealth(page, options);
  if (health.issues.length > 0) {
    throw new Error(`${label}: ${health.issues.join("; ")}`);
  }
  return health;
}

/**
 * Create a flag-value parser for CLI arguments.
 *
 * @param {string[]} [argv] - defaults to process.argv.slice(2)
 * @returns {{ getFlag: (flag: string, fallback?: string) => string|undefined, getIntFlag: (flag: string, fallback?: number) => number, hasFlag: (flag: string) => boolean }}
 */
export function createArgParser(argv = process.argv.slice(2)) {
  const getFlag = (flag, fallback = undefined) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const getIntFlag = (flag, fallback) => {
    const value = getFlag(flag);
    return value !== undefined ? parseInt(value, 10) : fallback;
  };
  const hasFlag = (flag) => argv.includes(flag);
  return { getFlag, getIntFlag, hasFlag };
}

/**
 * Wait for the debug bridge globals. CM6 mode exposes CM6 globals; Lexical
 * mode exposes the product-neutral `__editor` bridge plus the Lexical root.
 *
 * @param {import("playwright").Page} page
 * @param {object} [options]
 * @param {number} [options.timeout=15000]
 */
export async function waitForDebugBridge(page, { timeout = 15000 } = {}) {
  try {
    await page.waitForFunction(
      () => Boolean(
        window.__app
          && window.__editor
          && window.__cfDebug
          && (window.__cmView || document.querySelector("[data-testid='lexical-editor']")),
      ),
      { timeout, polling: 100 },
    );
    await page.evaluate(async () => {
      await Promise.all([
        window.__app?.ready,
        window.__editor?.ready,
        window.__cfDebug?.ready,
      ].filter(Boolean));
    });
  } catch (error) {
    const title = await page.title().catch(() => "");
    const diagnostics = await page.evaluate(() => {
      const globals = {
        __app: Boolean(window.__app),
        __editor: Boolean(window.__editor),
        __cmView: Boolean(window.__cmView),
        __cmDebug: Boolean(window.__cmDebug),
        __cfDebug: Boolean(window.__cfDebug),
        lexicalEditor: Boolean(document.querySelector("[data-testid='lexical-editor']")),
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

/**
 * Reset the editor to rich mode with a baseline regression document loaded.
 *
 * Browser regressions that intentionally save fixture edits must restore those
 * files before they finish, so the shared in-memory demo filesystem remains
 * clean across tests.
 *
 * @param {import("playwright").Page} page
 */
export async function resetEditorState(page) {
  await page.mouse.move(2, 2).catch(() => {});
  await sleep(50);
  await page.evaluate(() => {
    window.__app?.setSearchOpen?.(false);
  }).catch(() => {});
  const discarded = await discardCurrentFile(page).catch(() => false);
  if (!discarded) {
    throw new Error("Failed to discard the current document during reset");
  }
  await page.evaluate(() => {
    window.__app.setMode("cm6-rich");
  });
  await openRegressionDocument(page);
  await page.waitForFunction(
    () => {
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString() ?? "";
      return doc.includes("Coflat Feature Showcase") && doc.includes("SearchNeedle");
    },
    { timeout: 5000 },
  );
}

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
  await page.screenshot({ path, ...options });
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
  } catch {
    // Ignore disconnect errors — the browser may already be closed
  }
}
