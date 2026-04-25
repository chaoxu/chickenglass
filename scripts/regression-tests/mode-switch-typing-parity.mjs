/**
 * Regression test: real typing remains canonical while switching between
 * CM6 rich, Lexical, and source surfaces.
 */

import {
  openEditorScenario,
  readEditorText,
  settleEditorLayout,
  switchToMode,
  waitForDocumentStable,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "mode-switch-typing-parity";

const ANCHOR = "typing-anchor";

const FIXTURE = {
  virtualPath: "mode-switch-typing-parity.md",
  displayPath: "generated:mode-switch-typing-parity.md",
  content: [
    "# Mode Switch Typing Parity {#sec:typing-parity}",
    "",
    `The ${ANCHOR} is where every editor surface writes.`,
    "",
    '::: {.theorem #thm:typing-parity title="Typing parity"}',
    "The body contains $x+y=z$ and a stable reference target.",
    ":::",
    "",
    "$$",
    "x+y=z",
    "$$ {#eq:typing-parity}",
    "",
  ].join("\n"),
};

const STEPS = [
  { mode: "cm6-rich", text: " cm6-rich" },
  { mode: "lexical", text: " lexical" },
  { mode: "source", text: " source" },
  { mode: "cm6-rich", text: " cm6-rich-again" },
  { mode: "lexical", text: " lexical-again" },
];

async function typeAfterNeedle(page, needle, text) {
  const selection = await page.evaluate((targetNeedle) => {
    const editor = window.__editor;
    if (!editor?.getDoc || !editor?.setSelection || !editor?.focus) {
      throw new Error("window.__editor selection bridge is unavailable");
    }
    const doc = editor.getDoc();
    const index = doc.indexOf(targetNeedle);
    if (index < 0) {
      throw new Error(`Document is missing target ${JSON.stringify(targetNeedle)}`);
    }
    const anchor = index + targetNeedle.length;
    editor.setSelection(anchor, anchor);
    editor.focus();
    return editor.getSelection?.() ?? null;
  }, needle);

  await settleEditorLayout(page, { frameCount: 2, delayMs: 16 });
  await page.keyboard.type(text, { delay: 1 });
  await waitForDocumentStable(page, { quietMs: 250, timeoutMs: 5_000 });

  const expectedNeedle = `${needle}${text}`;
  const doc = await readEditorText(page);
  if (!doc.includes(expectedNeedle)) {
    throw new Error(
      `Typing ${JSON.stringify(text)} after ${JSON.stringify(needle)} failed; ` +
        `selection=${JSON.stringify(selection)}`,
    );
  }
  return expectedNeedle;
}

async function assertModeCanReadDocument(page, mode, expectedDoc) {
  await switchToMode(page, mode);
  await waitForRenderReady(page, {
    selector: mode === "lexical"
      ? ".cf-doc-flow--lexical"
      : mode === "source"
        ? ".cm-content"
        : ".cf-doc-flow--cm6 .cf-doc-heading",
    frameCount: 3,
    delayMs: 64,
    timeoutMs: 10_000,
  });
  const actual = await readEditorText(page);
  if (actual !== expectedDoc) {
    throw new Error(
      `Canonical markdown changed after switching to ${mode}: ` +
        `expected ${expectedDoc.length} chars, got ${actual.length}`,
    );
  }
}

export async function run(page) {
  await openEditorScenario(page, {
    entry: FIXTURE.virtualPath,
    files: {
      [FIXTURE.virtualPath]: FIXTURE.content,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cf-doc-flow--cm6 .cf-doc-heading" },
  });

  let needle = ANCHOR;
  for (const step of STEPS) {
    await switchToMode(page, step.mode);
    await waitForRenderReady(page, { frameCount: 3, delayMs: 64 });
    needle = await typeAfterNeedle(page, needle, step.text);
  }

  const expectedDoc = await readEditorText(page);
  for (const mode of ["cm6-rich", "lexical", "source"]) {
    await assertModeCanReadDocument(page, mode, expectedDoc);
  }

  return {
    pass: true,
    message: `typed ${STEPS.length} mode-switch edits and preserved ${expectedDoc.length} chars`,
  };
}
