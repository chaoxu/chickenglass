/* global window */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findAppPage, inspectBrowserPages } from "./chrome-common.mjs";

const DEFAULT_PORT = 9322;
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_BROWSER_MODE = "cdp";
const DEFAULT_MANAGED_VIEWPORT = { width: 1280, height: 900 };
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
  lexical: "Lexical",
  read: "Read",
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

function formatInspectablePages(pages) {
  if (pages.length === 0) return "<none>";
  return pages
    .map((page) => `[${page.contextIndex}:${page.pageIndex}] ${page.url || "<blank>"} score=${page.score}`)
    .join(" | ");
}

async function pageHasDebugBridge(page) {
  return page.evaluate(
    () => Boolean(window.__app && window.__cfDebug),
  ).catch(() => false);
}

async function waitForEditorSurface(page, timeout = 10000) {
  await page.waitForFunction(
    () => Boolean(window.__editor && document.querySelector('[data-testid="lexical-editor"]')),
    { timeout },
  );
}

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

export async function focusEditor(page) {
  await waitForEditorSurface(page);
  await page.evaluate(() => {
    window.__editor.focus();
  });
  await sleep(100);
}

export async function readEditorText(page) {
  await waitForEditorSurface(page);
  return page.evaluate(() => window.__editor.getDoc());
}

export async function getSelection(page) {
  await waitForEditorSurface(page);
  return page.evaluate(() => window.__editor.getSelection());
}

export async function setSelection(page, anchor, focus = anchor) {
  await waitForEditorSurface(page);
  await page.evaluate(({ nextAnchor, nextFocus }) => {
    window.__editor.setSelection(nextAnchor, nextFocus);
  }, { nextAnchor: anchor, nextFocus: focus });
  await sleep(100);
}

export async function saveCurrentFile(page) {
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await sleep(150);
}

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

export async function openFile(page, path) {
  await page.evaluate((nextPath) => window.__app.openFile(nextPath), path);
  await waitForEditorSurface(page);
  await sleep(300);
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

function buildFixtureProjectFiles(virtualPath, resolvedPath) {
  const root = fixtureRootForResolvedPath(resolvedPath);
  const projectPrefix = inferFixtureProjectPrefix(virtualPath);
  if (!root) {
    return null;
  }

  const projectRoot = projectPrefix ? resolve(root, projectPrefix) : root;
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    return null;
  }

  const files = [];

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const repoRelativePath = relative(root, absolutePath).replace(/\\/g, "/");
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
  return files;
}

function isMissingFixtureError(error) {
  return error instanceof Error && error.message.startsWith("Missing fixture for ");
}

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
      resolvedPath: null,
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

export async function openFixtureDocument(page, fixture, options = {}) {
  const resolved = resolveFixtureDocument(fixture);
  const { mode, discardCurrent = true, project = "single-file" } = options;
  const preferOpenFile = Boolean(
    resolved.resolvedPath?.startsWith(resolve(REPO_ROOT, "demo")),
  );
  const fixtureProjectFiles = project === "full-project" && resolved.resolvedPath
    ? buildFixtureProjectFiles(resolved.virtualPath, resolved.resolvedPath)
    : null;
  const singleFileProject = [{
    path: resolved.virtualPath,
    kind: "text",
    content: resolved.content,
  }];
  const projectFiles = fixtureProjectFiles ?? singleFileProject;
  const verificationWindow = 200;

  if (discardCurrent) {
    await discardCurrentFile(page).catch(() => false);
  }

  const result = await page.evaluate(
    async ({ path, expectedContent, tryOpenFileFirst, fixtureProjectFiles }) => {
      const app = window.__app;
      if (!app?.openFile) {
        throw new Error("window.__app.openFile is unavailable.");
      }

      const canOpenInCurrentProject = tryOpenFileFirst
        || (fixtureProjectFiles && app.hasFile ? await app.hasFile(path) : false);

      if (canOpenInCurrentProject) {
        try {
          await app.openFile(path);
          return { method: "openFile" };
        } catch (error) {
          if (!app.loadFixtureProject && !app.openFileWithContent) {
            throw error;
          }
        }
      }

      if (app.loadFixtureProject && fixtureProjectFiles) {
        await app.loadFixtureProject(fixtureProjectFiles, path);
        return { method: "loadFixtureProject" };
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
      tryOpenFileFirst: preferOpenFile,
      fixtureProjectFiles: projectFiles,
    },
  );

  await waitForEditorSurface(page);
  await page.waitForFunction(
    ({ method, path, expectedLength, expectedPrefix, expectedSuffix }) => {
      const text = window.__editor?.getDoc();
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const sourceMapRegions = window.__cfSourceMap?.regions.length ?? 0;
      if (typeof text !== "string" || currentPath !== path) {
        return false;
      }

      if (method !== "openFile" && sourceMapRegions === 0) {
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
    { timeout: 10000 },
  );
  if (mode) {
    await switchToMode(page, mode);
  }
  await sleep(200);

  return {
    ...resolved,
    method: result.method,
  };
}

export async function openRegressionDocument(page, path = "index.md", options = {}) {
  const opened = await openFixtureDocument(page, path, { project: "full-project", ...options });
  return opened.virtualPath;
}

/**
 * Open a regression document and wait an extra ~500ms for secondary indexing
 * passes (headings/tables/cross-refs) to settle. Prefer this over an inline
 * `waitForTimeout(500)` in regression tests that read post-load render state.
 */
export async function openAndSettleRegressionDocument(page, path = "index.md", options = {}) {
  const virtualPath = await openRegressionDocument(page, path, options);
  await sleep(500);
  return virtualPath;
}

export async function findLine(page, needle) {
  const doc = await readEditorText(page);
  const lines = doc.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) {
      return index + 1;
    }
  }
  return -1;
}

export async function switchToMode(page, mode) {
  const normalizedMode = mode.toLowerCase();
  if (!(normalizedMode in MODE_LABELS)) {
    throw new Error(`Unsupported mode "${mode}". Use lexical or source.`);
  }

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
  const targetLabel = MODE_LABELS[normalizedMode];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentLabel = (await modeButton.textContent())?.trim();
    if (currentLabel === targetLabel) return;
    await modeButton.click();
    await sleep(200);
  }

  const finalLabel = (await modeButton.textContent())?.trim();
  throw new Error(`Failed to switch editor mode to ${targetLabel}; current mode is ${finalLabel ?? "<unknown>"}.`);
}

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

export async function insertEditorText(page, text) {
  await waitForEditorSurface(page);
  await page.evaluate((nextText) => {
    window.__editor.insertText(nextText);
  }, text);
  await sleep(100);
}

export async function replaceEditorText(page, text) {
  await waitForEditorSurface(page);
  await page.evaluate((nextText) => {
    window.__editor.setDoc(nextText);
    window.__editor.setSelection(nextText.length);
  }, text);
  await sleep(100);
}

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

function issueMatches(text, patterns) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));
}

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

export function formatRuntimeIssues(issues, limit = 3) {
  if (issues.length === 0) return "none";
  return issues
    .slice(0, limit)
    .map((issue) => `[${issue.source}] ${issue.text}`)
    .join(" | ");
}

async function collectEditorHealth(page, options = {}) {
  const {
    maxVisibleDialogs = 0,
    maxVisibleHoverPreviews = 0,
  } = options;

  return page.evaluate((limits) => {
    const issues = [];
    const modeLabels = new Set(["lexical", "source"]);

    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((el) => isVisible(el)).length;

    if (!window.__app) issues.push("missing window.__app");
    if (!window.__cfDebug) issues.push("missing window.__cfDebug");

    const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
    if (currentDocument && !window.__editor) {
      issues.push("missing window.__editor");
    }

    const mode = window.__app?.getMode?.() ?? null;
    const text = window.__editor?.getDoc?.() ?? "";
    const selection = window.__editor?.getSelection?.() ?? null;
    const dialogCount = visibleCount('[role="dialog"]');
    const hoverPreviewCount = visibleCount(".cf-hover-preview-tooltip");

    if (!modeLabels.has(mode)) {
      issues.push(`invalid mode: ${String(mode)}`);
    }

    const docLength = typeof text === "string" ? text.length : -1;
    if (docLength < 0) {
      issues.push(`invalid doc length: ${docLength}`);
    }

    if (selection) {
      if (selection.anchor < 0 || selection.anchor > docLength) {
        issues.push(`selection.anchor out of bounds: ${selection.anchor}/${docLength}`);
      }
      if (selection.focus < 0 || selection.focus > docLength) {
        issues.push(`selection.focus out of bounds: ${selection.focus}/${docLength}`);
      }
    } else if (currentDocument) {
      issues.push("missing selection");
    }

    if (dialogCount > limits.maxVisibleDialogs) {
      issues.push(`too many visible dialogs: ${dialogCount}/${limits.maxVisibleDialogs}`);
    }
    if (hoverPreviewCount > limits.maxVisibleHoverPreviews) {
      issues.push(
        `too many visible hover previews: ${hoverPreviewCount}/${limits.maxVisibleHoverPreviews}`,
      );
    }

    const editorElement = document.querySelector('[data-testid="lexical-editor"]');

    return {
      currentDocument,
      mode,
      docLength,
      selection,
      hasEditorElement: Boolean(editorElement),
      dialogCount,
      hoverPreviewCount,
      issues,
    };
  }, {
    maxVisibleDialogs,
    maxVisibleHoverPreviews,
  });
}

export async function assertEditorHealth(page, label, options = {}) {
  const health = await collectEditorHealth(page, options);
  if (health.issues.length > 0) {
    throw new Error(`${label}: ${health.issues.join("; ")}`);
  }
  return health;
}

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

export async function waitForDebugBridge(page, { timeout = 15000 } = {}) {
  try {
    await page.waitForFunction(
      () => Boolean(window.__app && window.__cfDebug),
      { timeout },
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
    window.__app.setMode("lexical");
  });
  await openRegressionDocument(page);
  await page.waitForFunction(
    () => {
      const doc = window.__editor?.getDoc?.() ?? "";
      return doc.includes("Coflat Feature Showcase") && doc.includes("SearchNeedle");
    },
    { timeout: 5000 },
  );
}

export async function screenshot(page, path, options = {}) {
  await page.screenshot({ path, ...options });
}

export async function captureDebugState(page, label = "capture") {
  await waitForEditorSurface(page);
  const state = await page.evaluate(() => {
    const doc = window.__editor?.getDoc?.() ?? "";
    const selection = window.__editor?.getSelection?.() ?? null;
    const mode = window.__app?.getMode?.() ?? null;
    return { document: doc, selection, mode };
  });
  return { label, ...state, capturedAt: new Date().toISOString() };
}

export async function setCursor(page, line, col = 0) {
  await waitForEditorSurface(page);
  const doc = await readEditorText(page);
  const lines = doc.split("\n");
  if (line < 1 || line > lines.length) {
    throw new Error(`setCursor: line ${line} out of range (document has ${lines.length} lines).`);
  }
  let offset = 0;
  for (let i = 0; i < line - 1; i++) {
    offset += lines[i].length + 1;
  }
  offset += Math.min(col, lines[line - 1].length);
  await setSelection(page, offset, offset);
}

export async function jumpToTextAnchor(page, text, options = {}) {
  const { occurrence = 1, offset: charOffset = 0 } = options;
  await waitForEditorSurface(page);
  const doc = await readEditorText(page);
  let pos = -1;
  let found = 0;
  let searchFrom = 0;
  while (found < occurrence) {
    pos = doc.indexOf(text, searchFrom);
    if (pos === -1) {
      throw new Error(`jumpToTextAnchor: "${text}" occurrence ${occurrence} not found (found ${found}).`);
    }
    found += 1;
    searchFrom = pos + 1;
  }
  const anchor = Math.max(0, pos + charOffset);
  await setSelection(page, anchor, anchor);
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
