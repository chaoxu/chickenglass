/**
 * Regression test: switching between CM6 rich and CM6 source modes.
 *
 * Verifies the app can move between cm6-rich and source without changing
 * canonical markdown text or dirty state.
 */

import {
  openFixtureDocument,
  readEditorText,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "mode-switch";

const MODE_SWITCH_FIXTURE = {
  virtualPath: "mode-switch.md",
  displayPath: "generated:mode-switch.md",
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
    "The renderer should show this block after a mode switch.",
    ":::",
    "",
    "Final line for canonical text checks.",
    "",
  ].join("\n"),
};

const MODE_SEQUENCE = ["cm6-rich", "source", "cm6-rich"];

async function captureModeState(page) {
  return page.evaluate(() => {
    const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
    return {
      mode: window.__app?.getMode?.() ?? null,
      doc: window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString() ?? null,
      appDirty: window.__app?.isDirty?.() ?? null,
      currentDocumentDirty: currentDocument?.dirty ?? null,
      path: currentDocument?.path ?? null,
    };
  });
}

export async function run(page) {
  await openFixtureDocument(page, MODE_SWITCH_FIXTURE, {
    mode: "cm6-rich",
    timeoutMs: 15_000,
    settleMs: 200,
  });

  const initialDoc = await readEditorText(page);
  const initialState = await captureModeState(page);
  const initialDirty = Boolean(initialState.appDirty || initialState.currentDocumentDirty);

  for (const mode of MODE_SEQUENCE) {
    await switchToMode(page, mode);
    await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });

    const state = await captureModeState(page);
    if (state.mode !== mode) {
      return { pass: false, message: `expected mode ${mode}, got ${state.mode}` };
    }
    if (state.doc !== initialDoc) {
      return { pass: false, message: `mode ${mode}: canonical doc drift detected` };
    }
    const dirty = Boolean(state.appDirty || state.currentDocumentDirty);
    if (dirty !== initialDirty) {
      return { pass: false, message: `mode ${mode}: dirty state changed from ${initialDirty} to ${dirty}` };
    }
  }

  return {
    pass: true,
    message: `cycled through ${MODE_SEQUENCE.length} mode switches with stable canonical text`,
  };
}
