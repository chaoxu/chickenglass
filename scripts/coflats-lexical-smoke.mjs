#!/usr/bin/env node
/**
 * Coflats Lexical browser smoke.
 *
 * This is intentionally separate from `scripts/test-regression.mjs`: the
 * default regression lane still targets the CM6 editor, while this script
 * validates the runtime Lexical surface in the unified app.
 *
 * Starts the local Vite server automatically for localhost URLs unless
 * `--no-start-server` is passed.
 */

import console from "node:console";
import process from "node:process";
import {
  assertEditorHealth,
  connectEditor,
  createArgParser,
  DEBUG_EDITOR_SELECTOR,
  disconnectBrowser,
  ensureAppServer,
  formatSelection,
  openFixtureDocument,
  readEditorText,
  saveCurrentFile,
  sleep,
  switchToMode,
  waitForDebugBridge,
} from "./test-helpers.mjs";

const DEFAULT_URL = "http://localhost:5173";
const INSERT_MARKER = "COFLATSLEXICALSMOKEINSERT";

const FORMAT_FIXTURE = {
  virtualPath: "format-command.md",
  displayPath: "fixture:format-command.md",
  content: "Alpha Beta\n",
};

function selectSourceRange(doc, needle) {
  const from = doc.indexOf(needle);
  if (from < 0) {
    throw new Error(`Cannot find ${JSON.stringify(needle)} in fixture document.`);
  }
  return { from, to: from + needle.length };
}

function createHeavySmokeDoc() {
  const sections = [];
  for (let index = 1; index <= 180; index += 1) {
    sections.push([
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
    ].join("\n"));
  }
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

async function assertLexicalSurface(page) {
  const state = await page.evaluate((editorSelector) => ({
    hasLexicalRoot: Boolean(document.querySelector(editorSelector)),
    mode: window.__app?.getMode?.() ?? null,
    hasEditorBridge: Boolean(window.__editor),
  }), DEBUG_EDITOR_SELECTOR);

  if (!state.hasLexicalRoot) {
    throw new Error(
      "Lexical editor root did not mount after switching to Lexical mode.",
    );
  }
  if (!state.hasEditorBridge) {
    throw new Error("Product-neutral window.__editor bridge is unavailable.");
  }
}

async function runFormatScenario(page) {
  await openFixtureDocument(page, FORMAT_FIXTURE, { mode: "lexical" });
  await page.evaluate(({ from, to }) => {
    window.__editor.setSelection(from, to);
  }, selectSourceRange(FORMAT_FIXTURE.content, "Beta"));

  await formatSelection(page, { type: "bold" });
  const richFormatted = await readEditorText(page);
  if (richFormatted !== "Alpha **Beta**\n") {
    throw new Error(`Bold formatting produced ${JSON.stringify(richFormatted)}.`);
  }

  await switchToMode(page, "source");
  await page.evaluate(({ from, to }) => {
    window.__editor.setSelection(from, to);
  }, selectSourceRange(richFormatted, "Alpha"));

  await formatSelection(page, { type: "italic" });
  const sourceFormatted = await readEditorText(page);
  if (sourceFormatted !== "*Alpha* **Beta**\n") {
    throw new Error(`Source-mode italic formatting produced ${JSON.stringify(sourceFormatted)}.`);
  }
}

async function runModeAndHeavyTypingScenario(page) {
  const fixture = heavyFixture();
  await page.evaluate(async ({ path, content }) => {
    await window.__app.closeFile?.({ discard: true });
    await window.__app.openFileWithContent(path, content);
    window.__app.setMode("lexical");
  }, {
    path: fixture.virtualPath,
    content: fixture.content,
  });
  await page.waitForFunction(
    (path) => {
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const doc = window.__editor?.getDoc?.() ?? "";
      return currentPath === path && doc.length > 40_000 && doc.includes("Section 180");
    },
    fixture.virtualPath,
    { timeout: 30_000, polling: 100 },
  );
  await sleep(1_000);

  const before = await readEditorText(page);
  if (before.length < 20) {
    throw new Error(`Heavy fixture ${fixture.displayPath} opened with unexpectedly short content.`);
  }

  const insertAt = Math.min(before.length, Math.max(0, before.indexOf("\n\n") + 2));
  const insertText = `\n${INSERT_MARKER} $x^2 + y^2$ [@sec:intro]\n`;
  await page.evaluate(async ({ pos, text }) => {
    window.__editor.setSelection(pos);
    window.__editor.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  await switchToMode(page, "source");
  const sourceText = await readEditorText(page);
  if (sourceText !== afterTyping) {
    throw new Error("Switching the Lexical surface to source mode changed the canonical markdown.");
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

async function main() {
  const args = process.argv.slice(2);
  const { getFlag, getIntFlag, hasFlag } = createArgParser(args);
  const browser = getFlag("--browser", "managed");
  const timeout = getIntFlag("--timeout", 30_000);
  const url = getFlag("--url", DEFAULT_URL);
  const headless = !hasFlag("--headed");

  let page = null;
  let stopAppServer = null;
  try {
    stopAppServer = await ensureAppServer(url, {
      autoStart: !hasFlag("--no-start-server"),
    });
    page = await connectEditor({ browser, headless, timeout, url });
    await waitForDebugBridge(page, { timeout });
    await switchToMode(page, "lexical");
    await assertLexicalSurface(page);
    await assertEditorHealth(page, "lexical-initial");

    await runFormatScenario(page);
    await assertEditorHealth(page, "lexical-format");

    await runModeAndHeavyTypingScenario(page);
    await assertEditorHealth(page, "lexical-heavy-typing");

    console.log("Coflats Lexical browser smoke passed.");
  } finally {
    if (page) {
      await disconnectBrowser(page);
    }
    if (stopAppServer) {
      await stopAppServer();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
