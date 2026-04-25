/* global document, HTMLElement, window */

import { assertEditorHealth } from "./browser-health.mjs";
import {
  buildFixtureProjectPayload,
  DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
  DEFAULT_FIXTURE_SETTLE_MS,
  hasFixtureDocument,
  resolveFixtureDocument,
} from "./fixture-test-helpers.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import { waitForAnimationFrames } from "./editor-wait-helpers.mjs";
import { waitForRenderReady } from "./editor-render-helpers.mjs";
import {
  discardCurrentFile,
  replaceEditorText,
  saveCurrentFile,
  showSidebarPanel,
  switchToMode,
} from "./editor-state-helpers.mjs";

const RESET_EDITOR_STATE_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.fixtureOpenTimeoutMs;

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
  const preferOpenFile = resolved.displayPath.startsWith("demo/");
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

function normalizeScenarioFiles(files) {
  if (Array.isArray(files)) {
    return files;
  }
  return Object.entries(files ?? {}).map(([path, value]) => {
    if (typeof value === "string") {
      return { path, kind: "text", content: value };
    }
    return { path, ...value };
  });
}

/**
 * Open a generated or fixture-backed editor scenario through the same app
 * debug bridge used by browser regressions.
 *
 * @param {import("playwright").Page} page
 * @param {{
 *   entry?: string,
 *   files?: Record<string, string | { kind: "text" | "binary", content?: string, base64?: string }> | Array<{ path: string, kind: "text" | "binary", content?: string, base64?: string }>,
 *   fixture?: Parameters<typeof openFixtureDocument>[1],
 *   mode?: "rich" | "cm6-rich" | "lexical" | "source" | "CM6 Rich" | "Lexical" | "Source",
 *   project?: "single-file" | "full-project",
 *   waitFor?: {
 *     selector?: string,
 *     minCount?: number,
 *     timeoutMs?: number,
 *     frameCount?: number,
 *     delayMs?: number,
 *   },
 *   discardCurrent?: boolean,
 *   timeoutMs?: number,
 *   settleMs?: number,
 * }} scenario
 */
export async function openEditorScenario(page, scenario) {
  const {
    entry,
    files,
    fixture,
    mode = "cm6-rich",
    project = "single-file",
    waitFor = {},
    discardCurrent = true,
    timeoutMs = DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
    settleMs = DEFAULT_FIXTURE_SETTLE_MS,
  } = scenario ?? {};

  if (fixture) {
    const opened = await openFixtureDocument(page, fixture, {
      discardCurrent,
      mode,
      project,
      settleMs,
      timeoutMs,
    });
    if (waitFor.selector) {
      await waitForRenderReady(page, { timeoutMs, ...waitFor });
    }
    return {
      entry: opened.virtualPath,
      method: opened.method,
    };
  }

  const projectFiles = normalizeScenarioFiles(files);
  if (projectFiles.length === 0) {
    throw new Error("openEditorScenario requires either fixture or files.");
  }

  const initialPath = entry ?? projectFiles.find((file) => file.kind === "text")?.path;
  if (!initialPath) {
    throw new Error("openEditorScenario requires an entry path for binary-only projects.");
  }

  const textEntry = projectFiles.find((file) => file.path === initialPath && file.kind === "text");
  const expectedContent = textEntry?.content ?? null;

  if (discardCurrent) {
    await discardCurrentFile(page).catch(() => false);
  }

  const result = await page.evaluate(async ({ expectedPath, scenarioFiles }) => {
    const app = window.__app;
    if (!app?.loadFixtureProject && !app?.openFileWithContent) {
      throw new Error("window.__app fixture loading helpers are unavailable.");
    }
    if (app.loadFixtureProject) {
      await app.loadFixtureProject(scenarioFiles, expectedPath);
      return { method: "loadFixtureProject" };
    }

    const entry = scenarioFiles.find((file) => file.path === expectedPath);
    if (!entry || entry.kind !== "text" || typeof entry.content !== "string") {
      throw new Error(`window.__app.loadFixtureProject is unavailable for multi-file scenario ${expectedPath}.`);
    }
    await app.openFileWithContent(expectedPath, entry.content);
    return { method: "openFileWithContent" };
  }, {
    expectedPath: initialPath,
    scenarioFiles: projectFiles,
  });

  await page.waitForFunction(
    ({ expectedPath, expectedContent: nextExpectedContent }) => {
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const text = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString();
      if (currentPath !== expectedPath || typeof text !== "string") {
        return false;
      }
      return nextExpectedContent === null || text === nextExpectedContent;
    },
    {
      expectedContent,
      expectedPath: initialPath,
    },
    { timeout: timeoutMs, polling: 100 },
  );

  if (mode) {
    await switchToMode(page, mode);
  }
  await waitForRenderReady(page, {
    delayMs: settleMs,
    frameCount: 3,
    timeoutMs,
    ...waitFor,
  });

  return {
    entry: initialPath,
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

async function clearTransientScenarioState(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(2, 2).catch(() => {});
  await waitForAnimationFrames(page, 1);
  await page.evaluate(() => {
    window.__app?.setSearchOpen?.(false);
    window.__cmDebug?.clearStructure?.();
    window.__cmDebug?.clearMotionGuards?.();
    window.__cfDebug?.clearScrollGuards?.();
    window.__cfDebug?.clearInteractionLog?.();

    for (const tooltip of document.querySelectorAll(".cf-hover-preview-tooltip")) {
      if (tooltip instanceof HTMLElement) {
        tooltip.setAttribute("data-visible", "false");
        tooltip.style.display = "none";
      }
    }

    const active = document.activeElement;
    if (active instanceof HTMLElement && (
      active.closest('[role="dialog"]') ||
      active.closest(".cm-tooltip-autocomplete") ||
      active.closest(".cf-hover-preview-tooltip")
    )) {
      active.blur();
    }

    window.__cfDebug?.clearSession?.();
  }).catch(() => {});
  await waitForAnimationFrames(page, 2);
}

async function collectResetState(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((el) => isVisible(el)).length;

    return {
      autocompleteCount: visibleCount(".cm-tooltip-autocomplete"),
      dialogCount: visibleCount('[role="dialog"]'),
      hoverPreviewCount: visibleCount(".cf-hover-preview-tooltip"),
      interactionLogCount: window.__cfDebug?.interactionLog?.()?.length ?? 0,
      mode: window.__app?.getMode?.() ?? null,
      recorderStatus: window.__cfDebug?.recorderStatus?.() ?? null,
      scrollGuardCount: window.__cfDebug?.scrollGuards?.()?.length ?? 0,
      sidebar: window.__app?.getSidebarState?.() ?? null,
    };
  });
}

async function assertResetState(page) {
  await assertEditorHealth(page, "resetEditorState", {
    maxAutocompleteTooltips: 0,
    maxVisibleDialogs: 0,
    maxVisibleHoverPreviews: 0,
  });

  const state = await collectResetState(page);
  const issues = [];
  if (state.sidebar?.collapsed !== false || state.sidebar?.tab !== "files") {
    issues.push(`sidebar not reset: ${JSON.stringify(state.sidebar)}`);
  }
  if (state.scrollGuardCount !== 0) {
    issues.push(`scroll guards not cleared: ${state.scrollGuardCount}`);
  }
  if (state.interactionLogCount !== 0) {
    issues.push(`interaction log not cleared: ${state.interactionLogCount}`);
  }
  if ((state.recorderStatus?.queued ?? 0) !== 0 || (state.recorderStatus?.localEventCount ?? 0) !== 0) {
    issues.push(`debug recorder not cleared: ${JSON.stringify(state.recorderStatus)}`);
  }

  if (issues.length > 0) {
    throw new Error(`resetEditorState: ${issues.join("; ")}`);
  }
}

export async function resetEditorState(page) {
  await clearTransientScenarioState(page);
  const discarded = await discardCurrentFile(page).catch(() => false);
  if (!discarded) {
    throw new Error("Failed to discard the current document during reset");
  }
  await openRegressionDocument(page);
  await switchToMode(page, "cm6-rich");
  await showSidebarPanel(page, "files");
  await clearTransientScenarioState(page);
  await page.waitForFunction(
    () => {
      const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString() ?? "";
      return window.__app?.getMode?.() === "cm6-rich" &&
        Boolean(window.__cmView) &&
        doc.includes("Coflat Feature Showcase") &&
        doc.includes("SearchNeedle");
    },
    { timeout: RESET_EDITOR_STATE_TIMEOUT_MS },
  );
  await assertResetState(page);
}
