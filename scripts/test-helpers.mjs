/* global window */

import process from "node:process";
import { MODE_LABELS, sleep, waitForEditorSurface } from "./test-helpers/shared.mjs";
import { openRegressionDocument } from "./test-helpers/fixtures.mjs";
export { PUBLIC_SHOWCASE_FIXTURE } from "./test-helpers/shared.mjs";
export {
  connectEditor,
  disconnectBrowser,
  normalizeConnectEditorOptions,
  waitForAppUrl,
  waitForDebugBridge,
} from "./test-helpers/browser.mjs";
export {
  hasFixtureDocument,
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
