/* global window */

import process from "node:process";
import { MODE_LABELS, waitForEditorSurface } from "./test-helpers/shared.mjs";
import { waitForDebugBridge as waitForDebugBridgeImpl } from "./test-helpers/browser.mjs";
import { openRegressionDocument } from "./test-helpers/fixtures.mjs";
export { PUBLIC_SHOWCASE_FIXTURE, sleep } from "./test-helpers/shared.mjs";
export {
  connectEditor,
  disconnectBrowser,
  normalizeConnectEditorOptions,
  waitForAppUrl,
  waitForDebugBridge,
} from "./test-helpers/browser.mjs";
export {
  hasFixtureDocument,
  openAndSettleRegressionDocument,
  openFixtureDocument,
  openRegressionDocument,
  resolveFixtureDocument,
  resolveFixtureDocumentWithFallback,
} from "./test-helpers/fixtures.mjs";

export async function focusEditor(page) {
  await waitForEditorSurface(page);
  await page.evaluate(() => {
    window.__editor.focus();
  });
  await page.waitForFunction(
    () => Boolean(document.activeElement?.closest('[data-testid="lexical-editor"]')),
    undefined,
    { timeout: 5000 },
  );
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
  await waitForEditorSelection(page, anchor, focus);
}

export async function saveCurrentFile(page) {
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await page.waitForFunction(
    () => window.__app?.isDirty?.() === false,
    undefined,
    { timeout: 5000 },
  );
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
  await page.waitForFunction(
    () => !window.__app?.getCurrentDocument?.(),
    undefined,
    { timeout: 5000 },
  ).catch(() => {});
  return discarded;
}

export async function openFile(page, path) {
  await page.evaluate((nextPath) => window.__app.openFile(nextPath), path);
  await waitForEditorSurface(page);
  await page.waitForFunction(
    (expectedPath) => window.__app?.getCurrentDocument?.()?.path === expectedPath,
    path,
    { timeout: 10000 },
  );
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

/**
 * Switch the cursor-reveal presentation between "inline" (default — swaps
 * the styled subtree for a plain TextNode containing markdown source) and
 * "floating" (renders a floating panel anchored to the live subtree).
 *
 * Tests that drive floating-panel selectors (.cf-lexical-inline-token-panel-shell,
 * .cf-lexical-inline-math-source) must call `setRevealPresentation(page, "floating")`
 * after openRegressionDocument so the live editor mounts the floating variant.
 */
export async function setRevealPresentation(page, presentation) {
  if (presentation !== "inline" && presentation !== "floating") {
    throw new Error(`Unsupported reveal presentation "${presentation}". Use inline or floating.`);
  }
  await page.evaluate((next) => {
    const SETTINGS_KEY = "cf-settings";
    let parsed = {};
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    } catch {
      parsed = {};
    }
    parsed.revealPresentation = next;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
  }, presentation);
  await page.reload({ waitUntil: "load" });
  await waitForDebugBridgeImpl(page);
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
    return window.__app.getMode();
  }, normalizedMode);

  if (changedViaApp !== null) {
    await page.waitForFunction(
      (nextMode) => window.__app?.getMode?.() === nextMode,
      normalizedMode,
      { timeout: 5000 },
    );
    const finalMode = await page.evaluate(() => window.__app.getMode());
    if (finalMode !== normalizedMode) {
      throw new Error(`Failed to switch editor mode to ${normalizedMode}; current mode is ${finalMode}.`);
    }
    return;
  }

  const modeButton = page.getByTestId("mode-button");
  const targetLabel = MODE_LABELS[normalizedMode];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentLabel = (await modeButton.textContent())?.trim();
    if (currentLabel === targetLabel) return;
    await modeButton.click();
    await page.waitForFunction(
      ({ label }) => document.querySelector('[data-testid="mode-button"]')?.textContent?.trim() === label,
      { label: targetLabel },
      { timeout: 5000 },
    ).catch(() => {});
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
    undefined,
    { timeout: 5000 },
  );
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
    undefined,
    { timeout: 5000 },
  );
}

export async function insertEditorText(page, text) {
  await waitForEditorSurface(page);
  const expectedText = await page.evaluate((nextText) => {
    window.__editor.insertText(nextText);
    return window.__editor.getDoc();
  }, text);
  await waitForEditorText(page, expectedText);
}

export async function replaceEditorText(page, text) {
  await waitForEditorSurface(page);
  await page.evaluate((nextText) => {
    window.__editor.setDoc(nextText);
  }, text);
  await waitForEditorText(page, text);
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

const runtimeIssueIgnoreStackByPage = new WeakMap();

function activeRuntimeIssueIgnores(page) {
  return runtimeIssueIgnoreStackByPage.get(page) ?? [];
}

function pushRuntimeIssueIgnores(page, options) {
  const stack = activeRuntimeIssueIgnores(page);
  stack.push({
    ignoreConsole: options.ignoreConsole ?? [],
    ignorePageErrors: options.ignorePageErrors ?? [],
  });
  runtimeIssueIgnoreStackByPage.set(page, stack);
}

function popRuntimeIssueIgnores(page) {
  const stack = activeRuntimeIssueIgnores(page);
  stack.pop();
  if (stack.length === 0) {
    runtimeIssueIgnoreStackByPage.delete(page);
  }
}

function runtimeIssueIsIgnored(page, source, text) {
  const key = source === "pageerror" ? "ignorePageErrors" : "ignoreConsole";
  return activeRuntimeIssueIgnores(page).some((entry) => issueMatches(text, entry[key]));
}

export async function withRuntimeIssueCapture(page, run, options = {}) {
  const issues = [];

  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (runtimeIssueIsIgnored(page, "console", text)) return;
    issues.push({ source: "console", text });
  };

  const onPageError = (error) => {
    const text = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    if (runtimeIssueIsIgnored(page, "pageerror", text)) return;
    issues.push({ source: "pageerror", text });
  };

  pushRuntimeIssueIgnores(page, options);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const value = await run();
    await waitForBrowserSettled(page);
    return { value, issues };
  } catch (error) {
    if (error instanceof Error) {
      error.runtimeIssues = issues;
    }
    throw error;
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    popRuntimeIssueIgnores(page);
  }
}

export function formatRuntimeIssues(issues, limit = 3) {
  if (issues.length === 0) return "none";
  return issues
    .slice(0, limit)
    .map((issue) => `[${issue.source}] ${issue.text}`)
    .join(" | ");
}

export async function waitForBrowserSettled(page, frames = 2) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, frames);
}

export async function waitForEditorText(page, expectedText, timeout = 5000) {
  await waitForEditorSurface(page);
  await page.waitForFunction(
    (text) => window.__editor?.getDoc?.() === text,
    expectedText,
    { timeout },
  );
}

export async function waitForEditorSelection(page, anchor, focus = anchor, timeout = 5000) {
  await waitForEditorSurface(page);
  await page.waitForFunction(
    ({ expectedAnchor, expectedFocus }) => {
      const selection = window.__editor?.getSelection?.();
      return selection?.anchor === expectedAnchor && selection?.focus === expectedFocus;
    },
    {
      expectedAnchor: anchor,
      expectedFocus: focus,
    },
    { timeout },
  );
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

export async function resetEditorState(page) {
  await page.mouse.move(2, 2).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector(".cf-hover-preview-tooltip[data-visible='true']"),
    undefined,
    { timeout: 1000 },
  ).catch(() => {});
  await page.evaluate(() => {
    window.__app?.setSearchOpen?.(false);
  }).catch(() => {});
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key !== "cf-window-state" && !key.startsWith("cf-window-state:")) {
        continue;
      }
      try {
        const state = JSON.parse(window.localStorage.getItem(key) ?? "null");
        if (state && typeof state === "object") {
          state.currentDocument = null;
          window.localStorage.setItem(key, JSON.stringify(state));
        }
      } catch {
        window.localStorage.removeItem(key);
      }
    }
  }).catch(() => {});
  // Reset reveal presentation to the default ("inline") so a previous test
  // that switched to "floating" doesn't leak its setting into the next test.
  // Done before discard/open so the next document mounts the right plugin.
  const presentationDrifted = await page.evaluate(() => {
    const SETTINGS_KEY = "cf-settings";
    let parsed = {};
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    if (parsed.revealPresentation && parsed.revealPresentation !== "inline") {
      parsed.revealPresentation = "inline";
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
      return true;
    }
    return false;
  });
  if (presentationDrifted) {
    await page.reload({ waitUntil: "load" });
    await waitForDebugBridgeImpl(page);
  }
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
    undefined,
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
    const debugSession = window.__cfDebug?.exportSession?.({ includeDocument: false });
    return { debugSessionStatus: debugSession?.status ?? null, document: doc, selection, mode };
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
