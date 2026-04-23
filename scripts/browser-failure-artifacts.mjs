import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { screenshot } from "./browser-screenshot.mjs";
import {
  DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  DEBUG_EDITOR_SELECTOR,
} from "../src/debug/debug-bridge-contract.js";

export const DEFAULT_BROWSER_ARTIFACT_ROOT = "/tmp/coflat-browser-artifacts";

function truncateText(value, maxLength = 4000) {
  if (typeof value !== "string") return value;
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}...<truncated ${value.length - maxLength} chars>`
    : value;
}

function serializeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }
  return {
    message: String(error),
    name: "Error",
    stack: null,
  };
}

export function sanitizeArtifactLabel(label) {
  return String(label || "browser")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "browser";
}

export function resolveBrowserArtifactDir({
  label = "browser",
  now = new Date(),
  root = DEFAULT_BROWSER_ARTIFACT_ROOT,
} = {}) {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return resolve(root, `${stamp}-${sanitizeArtifactLabel(label)}`);
}

async function collectDebugState(page, label) {
  return page.evaluate(async ({ editorSelector, requiredGlobals, snapshotLabel }) => {
    const truncate = (value, maxLength = 4000) => {
      if (typeof value !== "string") return value;
      return value.length > maxLength
        ? `${value.slice(0, maxLength)}...<truncated ${value.length - maxLength} chars>`
        : value;
    };
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
    const doc = safe(() => window.__editor?.getDoc?.() ?? null);

    return {
      app: safe(() => ({
        currentDocument: window.__app?.getCurrentDocument?.() ?? null,
        dirty: window.__app?.isDirty?.() ?? null,
        mode: window.__app?.getMode?.() ?? null,
        projectRoot: window.__app?.getProjectRoot?.() ?? null,
        sidebar: window.__app?.getSidebarState?.() ?? null,
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
      debugGlobals: safe(() => ({
        ...Object.fromEntries(requiredGlobals.map((name) => [name, Boolean(window[name])])),
        __cmDebug: Boolean(window.__cmDebug),
        __cmView: Boolean(window.__cmView),
        lexicalEditor: Boolean(document.querySelector(editorSelector)),
      })),
      dom: safe(() => ({
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              testId: document.activeElement.getAttribute("data-testid"),
              text: truncate(document.activeElement.textContent ?? "", 1000),
            }
          : null,
        bodyText: truncate(document.body?.innerText ?? "", 4000),
        errorOverlay: truncate(
          document.querySelector("vite-error-overlay")?.shadowRoot?.textContent
            ?? document.querySelector("vite-error-overlay")?.textContent
            ?? "",
          4000,
        ),
      })),
      editor: {
        docHead: typeof doc === "string" ? truncate(doc.slice(0, 1500), 1500) : null,
        docLength: typeof doc === "string" ? doc.length : null,
        docRead: typeof doc === "string" ? "ok" : doc,
        docTail: typeof doc === "string" ? truncate(doc.slice(-1500), 1500) : null,
        selection: safe(() => window.__editor?.getSelection?.() ?? null),
      },
    };
  }, {
    editorSelector: DEBUG_EDITOR_SELECTOR,
    requiredGlobals: DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
    snapshotLabel: label,
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function createBrowserArtifactRecorder(page, options = {}) {
  const {
    maxEntries = 80,
    recordConsoleTypes = ["error", "warning"],
  } = options;
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseErrors = [];

  const pushBounded = (target, value) => {
    target.push(value);
    if (target.length > maxEntries) {
      target.shift();
    }
  };

  const onConsole = (message) => {
    const type = message.type?.() ?? "unknown";
    if (!recordConsoleTypes.includes(type)) return;
    const location = typeof message.location === "function" ? message.location() : {};
    pushBounded(consoleMessages, {
      location,
      text: truncateText(message.text?.() ?? ""),
      type,
    });
  };
  const onPageError = (error) => {
    pushBounded(pageErrors, serializeError(error));
  };
  const onRequestFailed = (request) => {
    const failure = request.failure?.();
    pushBounded(requestFailures, {
      failure: failure?.errorText ?? null,
      method: request.method?.() ?? null,
      resourceType: request.resourceType?.() ?? null,
      url: request.url?.() ?? null,
    });
  };
  const onResponse = (response) => {
    const status = response.status?.() ?? 0;
    if (status < 400) return;
    const request = response.request?.();
    pushBounded(responseErrors, {
      method: request?.method?.() ?? null,
      resourceType: request?.resourceType?.() ?? null,
      status,
      statusText: response.statusText?.() ?? "",
      url: response.url?.() ?? null,
    });
  };

  page.on?.("console", onConsole);
  page.on?.("pageerror", onPageError);
  page.on?.("requestfailed", onRequestFailed);
  page.on?.("response", onResponse);

  const dispose = () => {
    page.off?.("console", onConsole);
    page.off?.("pageerror", onPageError);
    page.off?.("requestfailed", onRequestFailed);
    page.off?.("response", onResponse);
  };

  const collect = async ({
    dispose: shouldDispose = false,
    error = null,
    label = "browser-failure",
    outDir = resolveBrowserArtifactDir({ label }),
  } = {}) => {
    if (shouldDispose) {
      dispose();
    }
    mkdirSync(outDir, { recursive: true });

    const summary = {
      capturedAt: new Date().toISOString(),
      consoleMessages,
      error: serializeError(error),
      label,
      pageErrors,
      requestFailures,
      responseErrors,
      url: typeof page.url === "function" ? page.url() : null,
    };

    const statePath = join(outDir, "debug-state.json");
    const summaryPath = join(outDir, "browser-artifacts.json");
    const screenshotPath = join(outDir, "screenshot.png");

    try {
      summary.debugState = await collectDebugState(page, label);
    } catch (stateError) {
      summary.debugState = {
        error: stateError instanceof Error ? stateError.message : String(stateError),
      };
    }

    try {
      await screenshot(page, screenshotPath, { timeout: 5000 });
      summary.screenshot = screenshotPath;
    } catch (screenshotError) {
      summary.screenshot = {
        error: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
      };
    }

    writeJson(summaryPath, summary);
    writeJson(statePath, summary.debugState);

    return {
      outDir,
      screenshot: summary.screenshot,
      statePath,
      summaryPath,
    };
  };

  return {
    collect,
    dispose,
  };
}
