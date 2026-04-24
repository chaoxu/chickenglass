/* global window */
/**
 * Editor and debug-bridge interaction helpers for browser scripts.
 */

import {
  buildFixtureProjectPayload,
  DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
  DEFAULT_FIXTURE_SETTLE_MS,
  hasFixtureDocument,
  REPO_DEMO_ROOT,
  resolveFixtureDocument,
} from "./fixture-test-helpers.mjs";
export {
  DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
  DEFAULT_FIXTURE_SETTLE_MS,
  EXTERNAL_DEMO_ROOT,
  EXTERNAL_FIXTURE_ROOT,
  hasFixtureDocument,
  PUBLIC_SHOWCASE_FIXTURE,
  resolveFixtureDocument,
  resolveFixtureDocumentWithFallback,
} from "./fixture-test-helpers.mjs";

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
  await settleEditorLayout(page);
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
 * Wait for one or more browser animation frames in the app page.
 *
 * @param {import("playwright").Page} page
 * @param {number} [frameCount=2]
 */
export async function waitForAnimationFrames(page, frameCount = 2) {
  await page.evaluate(async (nextFrameCount) => {
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
  }, Math.max(1, frameCount));
}

/**
 * Wait until the active editor bridge and semantic snapshot are available and
 * stable across animation frames.
 *
 * Lexical/source modes may not expose CM6 semantic debug data; in those modes
 * the canonical document text and app mode still provide the readiness key.
 *
 * @param {import("playwright").Page} page
 * @param {{ timeoutMs?: number, stableFrames?: number }} [options]
 */
export async function waitForSemanticReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
  const stableFrames = Math.max(1, options.stableFrames ?? 2);
  return page.evaluate(async ({ nextTimeoutMs, nextStableFrames }) => {
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

    const startedAt = performance.now();
    let lastKey = "";
    let stableCount = 0;
    while (performance.now() - startedAt < nextTimeoutMs) {
      const mode = window.__app?.getMode?.() ?? null;
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString?.();
      const semantics = window.__cmDebug?.semantics?.() ?? null;
      const revision = typeof semantics?.revision === "number" ? semantics.revision : null;
      if (typeof doc === "string" && mode) {
        const key = `${mode}:${doc.length}:${revision ?? "none"}`;
        if (key === lastKey) {
          stableCount += 1;
        } else {
          lastKey = key;
          stableCount = 0;
        }
        if (stableCount >= nextStableFrames) {
          return {
            docLength: doc.length,
            mode,
            revision,
          };
        }
      }
      await waitForFrame();
    }
    throw new Error(`Timed out waiting ${nextTimeoutMs}ms for semantic readiness.`);
  }, {
    nextStableFrames: stableFrames,
    nextTimeoutMs: timeoutMs,
  });
}

/**
 * Wait until the canonical document/mode/semantic revision has stayed unchanged
 * for a quiet window. Use this when a test is guarding against delayed sync
 * overwriting a recent edit.
 *
 * @param {import("playwright").Page} page
 * @param {{ quietMs?: number, timeoutMs?: number }} [options]
 */
export async function waitForDocumentStable(page, options = {}) {
  return page.evaluate(async ({ quietMs, timeoutMs }) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const hashText = (text) => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const readKey = () => {
      const mode = window.__app?.getMode?.() ?? null;
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString?.();
      const revision = window.__cmDebug?.semantics?.()?.revision ?? null;
      return typeof doc === "string" && mode
        ? `${mode}:${doc.length}:${revision}:${hashText(doc)}`
        : null;
    };

    const startedAt = performance.now();
    let stableSince = performance.now();
    let previousKey = readKey();
    while (performance.now() - startedAt < timeoutMs) {
      const currentKey = readKey();
      if (!currentKey) {
        stableSince = performance.now();
        previousKey = currentKey;
        await sleepInPage(25);
        continue;
      }
      if (currentKey !== previousKey) {
        previousKey = currentKey;
        stableSince = performance.now();
      }
      if (performance.now() - stableSince >= quietMs) {
        return true;
      }
      await sleepInPage(25);
    }
    throw new Error(`Timed out waiting ${timeoutMs}ms for ${quietMs}ms of stable document state.`);
  }, {
    quietMs: Math.max(0, options.quietMs ?? 250),
    timeoutMs: Math.max(1, options.timeoutMs ?? 5_000),
  });
}

/**
 * Wait for editor render readiness. Optionally require a selector to appear in
 * the active editor DOM before settling layout.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   selector?: string,
 *   minCount?: number,
 *   timeoutMs?: number,
 *   frameCount?: number,
 *   delayMs?: number,
 * }} [options]
 */
export async function waitForRenderReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
  await waitForSemanticReady(page, { timeoutMs });
  if (options.selector) {
    await page.waitForFunction(
      ({ selector, minCount }) =>
        document.querySelectorAll(selector).length >= minCount,
      {
        selector: options.selector,
        minCount: Math.max(1, options.minCount ?? 1),
      },
      { timeout: timeoutMs, polling: 100 },
    );
  }
  await settleEditorLayout(page, {
    delayMs: options.delayMs ?? 0,
    frameCount: options.frameCount ?? 2,
  });
}

/**
 * Wait until the CM6 scroller dimensions stop changing across animation
 * frames. Use this before scroll measurements so measured latency is not
 * mixed with fixture-open layout churn.
 *
 * @param {import("playwright").Page} page
 * @param {{ timeoutMs?: number, stableFrames?: number }} [options]
 */
export async function waitForScrollReady(page, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
  await waitForRenderReady(page, { timeoutMs, frameCount: 2 });
  await page.evaluate(async ({ nextTimeoutMs, nextStableFrames }) => {
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
    const readKey = () => {
      const view = window.__cmView;
      if (!view?.scrollDOM) {
        return null;
      }
      const scroller = view.scrollDOM;
      return [
        Math.round(scroller.scrollHeight),
        Math.round(scroller.clientHeight),
        Math.round(Math.max(0, scroller.scrollHeight - scroller.clientHeight)),
        Math.round(scroller.scrollTop),
        view.viewport?.from ?? -1,
        view.viewport?.to ?? -1,
      ].join(":");
    };

    const startedAt = performance.now();
    let previousKey = readKey();
    let stableCount = 0;
    while (performance.now() - startedAt < nextTimeoutMs) {
      await waitForFrame();
      const currentKey = readKey();
      if (!currentKey) {
        previousKey = currentKey;
        stableCount = 0;
        continue;
      }
      if (currentKey === previousKey) {
        stableCount += 1;
        if (stableCount >= nextStableFrames) {
          return true;
        }
      } else {
        previousKey = currentKey;
        stableCount = 0;
      }
    }
    throw new Error(`Timed out waiting ${nextTimeoutMs}ms for stable scroll layout.`);
  }, {
    nextStableFrames: Math.max(1, options.stableFrames ?? 2),
    nextTimeoutMs: timeoutMs,
  });
}

/**
 * Wait for a sidebar panel to be active and laid out.
 *
 * @param {import("playwright").Page} page
 * @param {"files" | "outline" | "diagnostics" | "runtime"} panel
 * @param {{ timeoutMs?: number }} [options]
 */
export async function waitForSidebarReady(page, panel, options = {}) {
  await page.waitForFunction(
    (nextPanel) => {
      const sidebar = window.__app?.getSidebarState?.();
      return sidebar && !sidebar.collapsed && sidebar.tab === nextPanel;
    },
    panel,
    { timeout: options.timeoutMs ?? 5_000, polling: 100 },
  );
  await settleEditorLayout(page, { frameCount: 2 });
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
  await waitForSemanticReady(page);
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
  await waitForSemanticReady(page);
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
  await waitForAnimationFrames(page, 2);
  return discarded;
}

/**
 * Open a file by path (e.g. "posts/2014-11-04-isotonic-....md").
 * Uses the app's real openFile function via window.__app.
 */
export async function openFile(page, path) {
  try {
    const opened = await page.evaluate(async (p) => {
      const app = window.__app;
      if (!app?.openFile) {
        throw new Error("window.__app.openFile is unavailable.");
      }
      if (app.hasFile && !(await app.hasFile(p))) {
        return false;
      }
      await app.openFile(p);
      return true;
    }, path);
    if (opened) {
      await waitForRenderReady(page, { delayMs: 100, frameCount: 3 });
      return;
    }
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
    resolved.resolvedPath?.startsWith(REPO_DEMO_ROOT),
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
  await waitForRenderReady(page, {
    delayMs: settleMs,
    frameCount: 3,
    timeoutMs,
  });

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

  await settleEditorLayout(page, { frameCount: 2 });
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
  const changedViaApp = await page.evaluate(async (nextMode) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const bridgeStart = performance.now();
    while (performance.now() - bridgeStart < 15_000) {
      if (window.__app?.setMode && window.__app?.getMode) {
        break;
      }
      await sleepInPage(50);
    }
    if (!window.__app?.setMode || !window.__app?.getMode) {
      return null;
    }
    window.__app.setMode(nextMode);
    const start = performance.now();
    while (performance.now() - start < 2_000) {
      const currentMode = window.__app?.getMode?.();
      if (currentMode === nextMode) {
        return currentMode;
      }
      await sleepInPage(50);
    }
    return window.__app?.getMode?.() ?? null;
  }, normalizedMode);

  if (changedViaApp === null) {
    const diagnostics = await page.evaluate(() => ({
      bodyText: document.body?.innerText?.slice(0, 200) ?? "",
      globals: {
        __app: Boolean(window.__app),
        __cfDebug: Boolean(window.__cfDebug),
        __cmView: Boolean(window.__cmView),
        __editor: Boolean(window.__editor),
      },
      title: document.title,
      url: location.href,
    })).catch((error) => ({
      evaluateError: error instanceof Error ? error.message : String(error),
    }));
    throw new Error(
      `Failed to switch editor mode to ${normalizedMode}; app debug bridge unavailable: ${JSON.stringify(diagnostics)}`,
    );
  }

  if (changedViaApp !== normalizedMode) {
    throw new Error(`Failed to switch editor mode to ${normalizedMode}; current mode is ${changedViaApp}.`);
  }
  await waitForRenderReady(page);
}

/**
 * Open a sidebar panel through the app debug bridge and wait for a settled frame.
 *
 * @param {import("playwright").Page} page
 * @param {"files" | "outline" | "diagnostics" | "runtime"} panel
 */
export async function showSidebarPanel(page, panel) {
  const changedViaApp = await page.evaluate(async (nextPanel) => {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForAnimationFrames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bridgeStart = performance.now();
    while (performance.now() - bridgeStart < 15_000) {
      if (window.__app?.showSidebarPanel && window.__app?.getSidebarState) {
        break;
      }
      await sleepInPage(50);
    }
    if (!window.__app?.showSidebarPanel || !window.__app?.getSidebarState) {
      return null;
    }
    window.__app.showSidebarPanel(nextPanel);
    const settleStart = performance.now();
    while (performance.now() - settleStart < 2_000) {
      const sidebar = window.__app.getSidebarState();
      if (!sidebar.collapsed && sidebar.tab === nextPanel) {
        await waitForAnimationFrames();
        return nextPanel;
      }
      await sleepInPage(25);
    }
    return window.__app.getSidebarState().tab;
  }, panel);

  if (changedViaApp === null) {
    throw new Error(`Failed to show sidebar panel ${panel}; app debug bridge unavailable.`);
  }
  if (changedViaApp !== panel) {
    throw new Error(`Failed to show sidebar panel ${panel}; current tab is ${changedViaApp}.`);
  }
  await waitForSidebarReady(page, panel);
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
  await settleEditorLayout(page);
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
  await settleEditorLayout(page);
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
  await settleEditorLayout(page);
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
  await waitForSemanticReady(page);
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
  await waitForSemanticReady(page);
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
  await waitForSemanticReady(page);
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

  await page.waitForFunction(
    () => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return tooltip instanceof HTMLElement &&
        tooltip.style.display !== "none" &&
        tooltip.childElementCount > 0;
    },
    null,
    { timeout: 5_000, polling: 100 },
  );
  await waitForRenderReady(page, { selector: ".cf-hover-preview-tooltip", frameCount: 1 });
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

  await page.waitForFunction(
    () => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip");
      return !(tooltip instanceof HTMLElement) || tooltip.style.display === "none";
    },
    null,
    { timeout: 2_000, polling: 100 },
  );
  await settleEditorLayout(page);
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
    await settleEditorLayout(page, { frameCount: 1, delayMs: 200 });
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
  await settleEditorLayout(page);
  return activated;
}

/**
 * Clear the active explicit structure-edit target.
 */
export async function clearStructure(page) {
  const cleared = await page.evaluate(() => window.__cmDebug.clearStructure());
  await settleEditorLayout(page);
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
  await waitForAnimationFrames(page, 1);
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
  await settleEditorLayout(page);
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
  await settleEditorLayout(page, { frameCount: 3 });
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
  await waitForAnimationFrames(page, 1);
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
