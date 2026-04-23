/**
 * Regression test: Lexical browser smoke coverage on the shared runner.
 *
 * Covers formatting commands, source-to-Lexical immediate edits, large-document
 * insertion, mode round-trips, and save/reopen persistence through the shared
 * managed browser harness.
 */

/* global document, requestAnimationFrame, window */

import {
  DEBUG_EDITOR_SELECTOR,
  formatSelection,
  openFixtureDocument,
  readEditorText,
  saveCurrentFile,
  sleep,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "lexical-smoke";

const INSERT_MARKER = "COFLATSLEXICALSMOKEINSERT";
const MODE_SWITCH_MARKER = "COFLATSLEXICALMODESWITCHINSERT";

const FORMAT_FIXTURE = {
  virtualPath: "format-command.md",
  displayPath: "fixture:format-command.md",
  content: "Alpha Beta\n",
};

const SOURCE_FORMAT_FIXTURE = {
  virtualPath: "source-format-command.md",
  displayPath: "fixture:source-format-command.md",
  content: "Alpha **Beta**\n",
};

const MODE_SWITCH_FIXTURE = {
  virtualPath: "lexical-mode-switch-authoring.md",
  displayPath: "generated:lexical-mode-switch-authoring.md",
  content: [
    "---",
    "title: Lexical Mode Switch Authoring",
    "---",
    "",
    "# Lexical Mode Switch Authoring {#sec:lexical-mode-switch}",
    "",
    "This document exercises Source to Lexical editing with canonical Pandoc-style markdown.",
    "",
    "::: {.definition #def:mode-switch-stability} Mode Switch Stability",
    "A mode switch keeps the canonical markdown snapshot as the source of truth.",
    ":::",
    "",
    "::: {.theorem #thm:mode-switch-stability} Mode Switch Theorem",
    "Every immediate authoring edit survives the delayed rich synchronization pass.",
    ":::",
    "",
    "::: {.proof}",
    "The proof starts before the insertion marker and references @thm:mode-switch-stability.",
    ":::",
    "",
    "$$",
    "s_1 + s_2 = s_3",
    "$$ {#eq:mode-switch-stability}",
    "",
    "| Surface | State |",
    "| --- | --- |",
    "| Source | active |",
    "| Lexical | active |",
    "",
  ].join("\n"),
};

function selectSourceRange(doc, needle) {
  const from = doc.indexOf(needle);
  if (from < 0) {
    throw new Error(`Cannot find ${JSON.stringify(needle)} in fixture document.`);
  }
  return { from, to: from + needle.length };
}

function createHeavySmokeDoc() {
  const sections = Array.from({ length: 180 }, (_, offset) => {
    const index = offset + 1;
    return [
      `## Section ${index} {#sec:smoke-${index}}`,
      "",
      `Paragraph ${index} references [@sec:smoke-${Math.max(1, index - 1)}] and keeps inline math $x_${index}^2 + y_${index}^2$.`,
      "",
      `::: {.theorem #thm:smoke-${index}} Smoke Theorem ${index}`,
      `For every $n$, the generated smoke invariant ${index} is stable.`,
      ":::",
      "",
      "$$",
      `a_${index} + b_${index} = c_${index}`,
      `$$ {#eq:smoke-${index}}`,
      "",
    ].join("\n");
  });

  return [
    "---",
    "title: Coflats Lexical Smoke",
    "---",
    "",
    "# Coflats Lexical Smoke {#sec:intro}",
    "",
    "::: {.blockquote}",
    "Canonical blockquote smoke content with $x + y$.",
    ":::",
    "",
    "+-------+------------------+",
    "| Input | Output           |",
    "+=======+==================+",
    "| graph | first paragraph  |",
    "|       |                  |",
    "|       | second paragraph |",
    "+-------+------------------+",
    "",
    ...sections,
  ].join("\n");
}

function heavyFixture() {
  return {
    virtualPath: "coflats-lexical-heavy-smoke.md",
    displayPath: "generated:coflats-lexical-heavy-smoke.md",
    content: createHeavySmokeDoc(),
  };
}

function firstDiffIndex(left, right) {
  const length = Math.min(left.length, right.length);
  const diffIndex = Array.from({ length }, (_, index) => index)
    .find((index) => left[index] !== right[index]);
  if (typeof diffIndex === "number") {
    return diffIndex;
  }
  return left.length === right.length ? -1 : length;
}

async function assertLexicalSurface(page) {
  await page.waitForFunction(
    (editorSelector) =>
      window.__app?.getMode?.() === "lexical" &&
      Boolean(document.querySelector(editorSelector)),
    DEBUG_EDITOR_SELECTOR,
    { timeout: 10_000, polling: 100 },
  );

  const state = await page.evaluate((editorSelector) => ({
    hasLexicalRoot: Boolean(document.querySelector(editorSelector)),
    mode: window.__app?.getMode?.() ?? null,
    hasEditorBridge: Boolean(window.__editor),
  }), DEBUG_EDITOR_SELECTOR);

  if (state.mode !== "lexical") {
    throw new Error(`Expected Lexical mode, got ${state.mode}.`);
  }
  if (!state.hasLexicalRoot) {
    throw new Error("Lexical editor root did not mount after switching to Lexical mode.");
  }
  if (!state.hasEditorBridge) {
    throw new Error("Product-neutral window.__editor bridge is unavailable.");
  }
}

async function switchToModeAfterLexicalMutation(page, mode) {
  try {
    await switchToMode(page, mode);
  } catch (error) {
    const firstError = error instanceof Error ? error.message : String(error);
    await sleep(500);
    try {
      await switchToMode(page, mode);
    } catch (retryError) {
      const secondError = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(
        `Failed to switch to ${mode} after Lexical mutation; first attempt: ${firstError}; retry: ${secondError}`,
      );
    }
  }
}

async function runFormatScenario(page) {
  await openFixtureDocument(page, FORMAT_FIXTURE, { mode: "lexical" });
  await assertLexicalSurface(page);
  await page.evaluate(({ from, to }) => {
    window.__editor.setSelection(from, to);
  }, selectSourceRange(FORMAT_FIXTURE.content, "Beta"));

  await formatSelection(page, { type: "bold" });
  const richFormatted = await readEditorText(page);
  if (richFormatted !== "Alpha **Beta**\n") {
    throw new Error(`Bold formatting produced ${JSON.stringify(richFormatted)}.`);
  }

  await openFixtureDocument(page, SOURCE_FORMAT_FIXTURE, { mode: "source" });
  await page.evaluate(({ from, to }) => {
    window.__editor.setSelection(from, to);
  }, selectSourceRange(SOURCE_FORMAT_FIXTURE.content, "Alpha"));

  await formatSelection(page, { type: "italic" });
  const sourceFormatted = await readEditorText(page);
  if (sourceFormatted !== "*Alpha* **Beta**\n") {
    throw new Error(`Source-mode italic formatting produced ${JSON.stringify(sourceFormatted)}.`);
  }
}

async function runSourceToLexicalImmediateEditScenario(page) {
  await openFixtureDocument(page, MODE_SWITCH_FIXTURE, {
    mode: "source",
    timeoutMs: 30_000,
    settleMs: 300,
  });
  await page.evaluate(() => {
    const doc = window.__editor.getDoc();
    window.__editor.setSelection(doc.length, doc.length);
    window.__editor.insertText("\n## Source Appendix {#sec:lexical-mode-switch-appendix}\n\nSource edit before Lexical switch.\n");
  });
  await page.waitForFunction(
    () => window.__editor?.getDoc?.().includes("Source edit before Lexical switch."),
    null,
    { timeout: 10_000, polling: 100 },
  );

  await switchToMode(page, "lexical");
  await assertLexicalSurface(page);
  await page.waitForFunction(
    ({ editorSelector, proofText }) => {
      const doc = window.__editor?.getDoc?.() ?? "";
      return window.__app?.getMode?.() === "lexical" &&
        Boolean(document.querySelector(editorSelector)) &&
        doc.includes(proofText);
    },
    {
      editorSelector: DEBUG_EDITOR_SELECTOR,
      proofText: "The proof starts before the insertion marker",
    },
    { timeout: 10_000, polling: 100 },
  );
  await page.evaluate((marker) => {
    const doc = window.__editor.getDoc();
    const pos = doc.indexOf("The proof starts before the insertion marker");
    if (pos < 0) {
      throw new Error("Cannot find proof insertion point after switching to Lexical.");
    }
    window.__editor.setSelection(pos, pos);
    window.__editor.insertText(`${marker} `);
  }, MODE_SWITCH_MARKER);
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    MODE_SWITCH_MARKER,
    { timeout: 10_000, polling: 100 },
  );
  await sleep(750);

  const afterDeferredSync = await readEditorText(page);
  if (!afterDeferredSync.includes(MODE_SWITCH_MARKER)) {
    throw new Error("Immediate Lexical edit was lost after delayed rich synchronization.");
  }
  if (!afterDeferredSync.includes("Source edit before Lexical switch.")) {
    throw new Error("Source edit was lost after Source to Lexical authoring scenario.");
  }

  await switchToMode(page, "cm6-rich");
  const afterRoundTrip = await readEditorText(page);
  if (!afterRoundTrip.includes(MODE_SWITCH_MARKER)) {
    throw new Error("Immediate Lexical edit was lost after returning to CM6 Rich.");
  }
}

async function runModeAndHeavyTypingScenario(page) {
  const fixture = heavyFixture();
  await openFixtureDocument(page, fixture, {
    mode: "lexical",
    timeoutMs: 45_000,
    settleMs: 1_000,
  });
  await assertLexicalSurface(page);
  await page.waitForFunction(
    (path) => {
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const doc = window.__editor?.getDoc?.() ?? "";
      return currentPath === path && doc.length > 40_000 && doc.includes("Section 180");
    },
    fixture.virtualPath,
    { timeout: 30_000, polling: 100 },
  );

  const before = await readEditorText(page);
  if (before.length < 20) {
    throw new Error(`Heavy fixture ${fixture.displayPath} opened with unexpectedly short content.`);
  }

  const insertAt = Math.min(before.length, Math.max(0, before.indexOf("\n\n") + 2));
  const insertText = `\n${INSERT_MARKER} $x^2 + y^2$ [@sec:intro]\n`;
  await page.evaluate(async ({ pos, text }) => {
    const waitForAnimationFrames = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );

    window.__editor.setSelection(pos, pos);
    window.__editor.focus();
    await waitForAnimationFrames();
    window.__editor.insertText(text);
  }, { pos: insertAt, text: insertText });

  try {
    await page.waitForFunction(
      (marker) => window.__editor?.getDoc?.().includes(marker),
      INSERT_MARKER,
      { timeout: 10_000, polling: 100 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate((marker) => {
      const doc = window.__editor?.getDoc?.() ?? "";
      return {
        docLength: doc.length,
        markerPresent: doc.includes(marker),
        selection: window.__editor?.getSelection?.() ?? null,
      };
    }, INSERT_MARKER);
    throw new Error(`Lexical smoke insertion did not reach canonical markdown: ${JSON.stringify(diagnostics)}; ${error instanceof Error ? error.message : String(error)}`);
  }

  const afterTyping = await readEditorText(page);
  await switchToModeAfterLexicalMutation(page, "source");
  const sourceText = await readEditorText(page);
  if (sourceText !== afterTyping) {
    const diffIndex = firstDiffIndex(afterTyping, sourceText);
    throw new Error(
      `Switching the Lexical surface to source mode changed the canonical markdown: ` +
        `lexicalLength=${afterTyping.length}, sourceLength=${sourceText.length}, ` +
        `diffIndex=${diffIndex}, lexical=${JSON.stringify(afterTyping.slice(diffIndex, diffIndex + 80))}, ` +
        `source=${JSON.stringify(sourceText.slice(diffIndex, diffIndex + 80))}`,
    );
  }

  await saveCurrentFile(page);
  const currentPath = await page.evaluate(() => window.__app.getCurrentDocument()?.path ?? null);
  if (!currentPath) {
    throw new Error("No current document after saving Lexical smoke fixture.");
  }
  await page.evaluate(async (path) => {
    await window.__app.openFile(path);
  }, currentPath);
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    INSERT_MARKER,
    { timeout: 10_000, polling: 100 },
  );
}

export async function run(page) {
  await runFormatScenario(page);
  await runSourceToLexicalImmediateEditScenario(page);
  await runModeAndHeavyTypingScenario(page);

  return {
    pass: true,
    message: "Lexical format, mode switch, heavy edit, and save/reopen smoke passed",
  };
}
