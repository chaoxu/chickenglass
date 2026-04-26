/* global window */

import { sleep, waitForDebugBridge } from "./browser-lifecycle.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import {
  DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  DEBUG_EDITOR_SELECTOR,
} from "../src/debug/debug-bridge-contract.js";

const DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;

function issueMatches(text, patterns) {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return text.includes(pattern);
    }
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

const DEFAULT_IGNORED_REQUEST_FAILURES = [
  /net::ERR_ABORTED/u,
  /\/__coflat\/debug-event(?:[?#]|$)/u,
  /\/favicon\.ico(?:[?#]|$)/u,
];
const DEFAULT_IGNORED_HTTP_STATUSES = [
  /\/__coflat\/debug-event(?:[?#]|$)/u,
  /\/favicon\.ico(?:[?#]|$)/u,
];

function requestMethod(request) {
  return typeof request?.method === "function" ? request.method() : "REQUEST";
}

function requestUrl(request) {
  return typeof request?.url === "function" ? request.url() : "<unknown-url>";
}

function requestFailureText(request) {
  const failure = typeof request?.failure === "function" ? request.failure() : null;
  return failure?.errorText ?? "request failed";
}

/**
 * Capture runtime issues emitted during a browser scenario.
 *
 * Collects `console.error(...)` messages, uncaught page errors, unexpected
 * request failures, and HTTP 4xx/5xx responses while the callback runs, then
 * returns both the callback result and any captured issues.
 *
 * @param {import("playwright").Page} page
 * @param {() => Promise<unknown>} run
 * @param {{
 *   captureNetwork?: boolean,
 *   ignoreConsole?: Array<string | RegExp>,
 *   ignoreHttpStatuses?: Array<string | RegExp>,
 *   ignorePageErrors?: Array<string | RegExp>,
 *   ignoreRequestFailures?: Array<string | RegExp>,
 * }} [options]
 */
export async function withRuntimeIssueCapture(page, run, options = {}) {
  const issues = [];
  const captureNetwork = options.captureNetwork !== false;
  const ignoreConsole = options.ignoreConsole ?? [];
  const ignoreHttpStatuses = [
    ...DEFAULT_IGNORED_HTTP_STATUSES,
    ...(options.ignoreHttpStatuses ?? []),
  ];
  const ignorePageErrors = options.ignorePageErrors ?? [];
  const ignoreRequestFailures = [
    ...DEFAULT_IGNORED_REQUEST_FAILURES,
    ...(options.ignoreRequestFailures ?? []),
  ];

  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const location = typeof msg.location === "function" ? msg.location() : {};
    const locationText = location.url
      ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
      : "";
    const text = `${msg.text()}${locationText}`;
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

  const onRequestFailed = (request) => {
    const text = `${requestMethod(request)} ${requestUrl(request)} ${requestFailureText(request)}`;
    if (issueMatches(text, ignoreRequestFailures)) return;
    issues.push({ source: "requestfailed", text });
  };

  const onResponse = (response) => {
    const status = typeof response?.status === "function" ? response.status() : 0;
    if (status < 400) return;
    const request = typeof response?.request === "function" ? response.request() : null;
    const text = `${status} ${requestMethod(request)} ${typeof response?.url === "function" ? response.url() : "<unknown-url>"}`;
    if (issueMatches(text, ignoreHttpStatuses)) return;
    issues.push({ source: "response", text });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  if (captureNetwork) {
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);
  }

  try {
    const value = await run();
    await sleep(100);
    return { value, issues };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    if (captureNetwork) {
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    }
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
export async function collectEditorHealth(page, options = {}) {
  const {
    maxVisibleDialogs = 0,
    maxVisibleHoverPreviews = 1,
    maxAutocompleteTooltips = 1,
  } = options;

  return page.evaluate(async (limits) => {
    const issues = [];
    const modeLabels = new Set(["cm6-rich", "lexical", "source"]);

    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((el) => isVisible(el)).length;

    const missingRequiredGlobals = limits.requiredGlobals.filter((name) => !window[name]);
    const hasCmBridge = Boolean(window.__cmView && window.__cmDebug);
    for (const name of missingRequiredGlobals) {
      issues.push(`missing window.${name}`);
    }
    if (!window.__editor && !hasCmBridge) issues.push("missing editor debug bridge");

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
    const runtimeContract = await window.__cfDebug?.runtimeContract?.().catch((error) => ({
      issues: [`runtime contract threw: ${error instanceof Error ? error.message : String(error)}`],
    })) ?? null;
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
    for (const issue of runtimeContract?.issues ?? []) {
      issues.push(`runtime contract: ${issue}`);
    }

    return {
      mode,
      docLength,
      selection,
      semantics,
      runtimeContract,
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
    requiredGlobals: DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
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

function normalizeUrlForDoctor(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return {
      origin: parsed.origin,
      pathname,
    };
  } catch (_error) {
    return null;
  }
}

function assertDoctorUrl(currentUrl, targetUrl) {
  if (!targetUrl) return;
  const current = normalizeUrlForDoctor(currentUrl);
  const target = normalizeUrlForDoctor(targetUrl);
  if (!current || !target) {
    throw new Error(`browser doctor: invalid URL state current=${currentUrl} target=${targetUrl}`);
  }
  if (current.origin !== target.origin || current.pathname !== target.pathname) {
    throw new Error(
      `browser doctor: wrong app page ${currentUrl}; expected ${targetUrl}`,
    );
  }
}

async function collectBrowserDoctorState(page) {
  return page.evaluate(({ editorSelector, requiredGlobals }) => {
    const overlay = document.querySelector("vite-error-overlay");
    const overlayText = overlay?.shadowRoot?.textContent ?? overlay?.textContent ?? "";
    return {
      debugGlobals: {
        ...Object.fromEntries(requiredGlobals.map((name) => [name, Boolean(window[name])])),
        __cmView: Boolean(window.__cmView),
        lexicalEditor: Boolean(document.querySelector(editorSelector)),
      },
      readyState: document.readyState,
      title: document.title,
      url: window.location.href,
      viteErrorOverlay: overlayText.trim(),
    };
  }, {
    editorSelector: DEBUG_EDITOR_SELECTOR,
    requiredGlobals: DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  });
}

/**
 * Run the canonical browser harness readiness check before a scenario starts.
 *
 * This catches the common false-failure cases early: wrong page attachment,
 * missing debug globals, Vite error overlays, and broken editor health.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   health?: Parameters<typeof assertEditorHealth>[2],
 *   label?: string,
 *   targetUrl?: string,
 *   timeout?: number,
 * }} [options]
 */
export async function runBrowserDoctor(page, options = {}) {
  const {
    health = {},
    label = "browser doctor",
    targetUrl = "",
    timeout = DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS,
  } = options;

  assertDoctorUrl(page.url(), targetUrl);
  await waitForDebugBridge(page, { timeout });
  const state = await collectBrowserDoctorState(page);
  if (state.viteErrorOverlay) {
    throw new Error(`${label}: Vite error overlay visible: ${state.viteErrorOverlay.slice(0, 500)}`);
  }
  const editorHealth = await assertEditorHealth(page, label, health);
  return {
    ...state,
    editorHealth,
  };
}
