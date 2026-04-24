/**
 * Regression test: switching across all runtime editor surfaces.
 *
 * Verifies the merged app can move through CM6 rich, Lexical, and CM6 source
 * modes without changing canonical markdown text, dirty state, or the active
 * surface identity exposed to the shared debug bridge.
 */

import {
  DEBUG_EDITOR_SELECTOR,
  openFixtureDocument,
  readEditorText,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "mode-switch";

const MODE_SWITCH_FIXTURE = {
  virtualPath: "mode-switch-three-surface.md",
  displayPath: "generated:mode-switch-three-surface.md",
  content: [
    "# Mode Switch Regression",
    "",
    "This document keeps **formatting**, inline math $x^2 + y^2$, and a display equation stable.",
    "",
    "$$",
    "x^2 + y^2 = z^2",
    "$$ {#eq:mode-switch}",
    "",
    '::: {.theorem #thm:mode-switch title="Stable renderer"}',
    "The lexical renderer should show this block after a mode switch.",
    ":::",
    "",
    "Final line for canonical text checks.",
    "",
  ].join("\n"),
};

const MODE_SEQUENCE = [
  "cm6-rich",
  "lexical",
  "source",
  "cm6-rich",
  "source",
  "lexical",
];

function expectedSurfaceForMode(mode) {
  return mode === "lexical" ? "lexical" : "cm6";
}

async function captureModeState(page) {
  return page.evaluate((lexicalSelector) => {
    const cmRoot = window.__cmView?.dom ?? null;
    const lexicalRoot = document.querySelector(lexicalSelector);
    const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
    const hasCmSurface = Boolean(cmRoot?.isConnected);
    const hasLexicalSurface = Boolean(lexicalRoot?.isConnected);
    const surface = hasLexicalSurface ? "lexical" : hasCmSurface ? "cm6" : "none";
    const cmKatexCount = cmRoot?.querySelectorAll(".katex").length ?? 0;
    const richWidgetCount = cmRoot?.querySelectorAll(
      ".cf-block-header, .cf-math-inline, .cf-math-display",
    ).length ?? 0;
    const lexicalDisplayMathCount = lexicalRoot
      ?.querySelectorAll(".cf-lexical-display-math").length ?? 0;
    const lexicalBlockCount = lexicalRoot
      ?.querySelectorAll(".cf-lexical-block--theorem").length ?? 0;
    const lexicalFallbackCount = lexicalRoot
      ?.querySelectorAll("[data-coflat-raw-block-fallback='true']").length ?? 0;

    return {
      mode: window.__app?.getMode?.() ?? null,
      doc: window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString() ?? null,
      appDirty: window.__app?.isDirty?.() ?? null,
      currentDocumentDirty: currentDocument?.dirty ?? null,
      path: currentDocument?.path ?? null,
      surface,
      hasCmSurface,
      hasLexicalSurface,
      cmSurfaceIdentity: hasCmSurface ? "cm6" : null,
      lexicalSurfaceIdentity: hasLexicalSurface
        ? lexicalRoot.getAttribute("data-testid")
        : null,
      cmKatexCount,
      richWidgetCount,
      lexicalDisplayMathCount,
      lexicalBlockCount,
      lexicalFallbackCount,
    };
  }, DEBUG_EDITOR_SELECTOR);
}

async function waitForExpectedModeState(page, expectedMode, expectedDoc, expectedDirty) {
  const expectedSurface = expectedSurfaceForMode(expectedMode);
  await page.waitForFunction(
    ({ mode, doc, dirty, surface, lexicalSelector }) => {
      const cmRoot = window.__cmView?.dom ?? null;
      const lexicalRoot = document.querySelector(lexicalSelector);
      const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
      const hasCmSurface = Boolean(cmRoot?.isConnected);
      const hasLexicalSurface = Boolean(lexicalRoot?.isConnected);
      const activeSurface = hasLexicalSurface ? "lexical" : hasCmSurface ? "cm6" : "none";
      return window.__app?.getMode?.() === mode
        && window.__editor?.getDoc?.() === doc
        && window.__app?.isDirty?.() === dirty
        && currentDocument?.dirty === dirty
        && activeSurface === surface;
    },
    {
      mode: expectedMode,
      doc: expectedDoc,
      dirty: expectedDirty,
      surface: expectedSurface,
      lexicalSelector: DEBUG_EDITOR_SELECTOR,
    },
    { timeout: 10_000, polling: 100 },
  );
  await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });
  return captureModeState(page);
}

function validateState(state, expectedMode, expectedDoc, expectedDirty) {
  const expectedSurface = expectedSurfaceForMode(expectedMode);
  if (state.mode !== expectedMode) {
    return `expected mode ${expectedMode}, got ${state.mode}`;
  }
  if (state.doc !== expectedDoc) {
    return `document text changed in ${expectedMode}: expected ${expectedDoc.length} chars, got ${state.doc?.length ?? "null"}`;
  }
  if (state.appDirty !== expectedDirty || state.currentDocumentDirty !== expectedDirty) {
    return `dirty state changed in ${expectedMode}: app=${state.appDirty}, document=${state.currentDocumentDirty}, expected=${expectedDirty}`;
  }
  if (state.surface !== expectedSurface) {
    return `expected ${expectedSurface} surface in ${expectedMode}, got ${state.surface}`;
  }
  if (expectedMode === "source" && state.cmKatexCount > 0) {
    return `source mode still has ${state.cmKatexCount} rendered KaTeX elements`;
  }
  if (expectedMode === "lexical" && state.lexicalSurfaceIdentity !== "lexical-editor") {
    return `lexical mode mounted unexpected surface identity ${state.lexicalSurfaceIdentity}`;
  }
  if (expectedMode === "lexical" && state.lexicalFallbackCount > 0) {
    return `lexical mode rendered ${state.lexicalFallbackCount} fallback raw block shells`;
  }
  if (expectedMode === "lexical" && state.lexicalDisplayMathCount < 1) {
    return "lexical mode did not render display math";
  }
  if (expectedMode === "lexical" && state.lexicalBlockCount < 1) {
    return "lexical mode did not render theorem blocks";
  }
  if (expectedSurface === "cm6" && state.cmSurfaceIdentity !== "cm6") {
    return `CM6 mode mounted unexpected surface identity ${state.cmSurfaceIdentity}`;
  }
  return null;
}

export async function run(page) {
  await openFixtureDocument(page, MODE_SWITCH_FIXTURE, { mode: "cm6-rich" });
  const expectedDoc = await readEditorText(page);
  const expectedDirty = true;

  if (expectedDoc !== MODE_SWITCH_FIXTURE.content) {
    return {
      pass: false,
      message:
        `fixture opened with unexpected text: expected ` +
        `${MODE_SWITCH_FIXTURE.content.length} chars, got ${expectedDoc.length}`,
    };
  }

  const states = [];
  for (const mode of MODE_SEQUENCE) {
    try {
      await switchToMode(page, mode);
      const state = await waitForExpectedModeState(page, mode, expectedDoc, expectedDirty);
      const failure = validateState(state, mode, expectedDoc, expectedDirty);
      if (failure) {
        return { pass: false, message: failure };
      }
      states.push(state);
    } catch (error) {
      const state = await captureModeState(page).catch(() => null);
      return {
        pass: false,
        message:
          `failed while switching to ${mode}: ` +
          `${error instanceof Error ? error.message : String(error)}; ` +
          `state=${JSON.stringify(state)}`,
      };
    }
  }

  const restoredRichStates = states
    .slice(1)
    .filter((state) => state.mode === "cm6-rich");
  if (restoredRichStates.length === 0 || restoredRichStates.some((state) => state.richWidgetCount === 0)) {
    return {
      pass: false,
      message: "CM6 rich mode did not restore rendered rich widgets after mode switching",
    };
  }

  return {
    pass: true,
    message:
      `preserved ${expectedDoc.length} chars and dirty=${expectedDirty} across ` +
      states.map((state) => `${state.mode}:${state.surface}`).join(" -> "),
  };
}
