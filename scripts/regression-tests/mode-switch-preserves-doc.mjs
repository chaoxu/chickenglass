import {
  DEBUG_EDITOR_SELECTOR,
  openFixtureDocument,
  readEditorText,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "mode-switch-preserves-doc";
export const groups = ["app"];

const FIXTURE = {
  virtualPath: "mode-switch.md",
  displayPath: "fixture:mode-switch.md",
  content: `---
title: Mode Switching
bibliography: refs.bib
---

# Introduction {#sec:intro}

::: {.theorem #thm:main} Main Result
Let $x$ be a positive integer.
:::

See [@thm:main] and $$ x^2 $$ {#eq:main}.
`,
};

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });
  const before = await readEditorText(page);

  await switchToMode(page, "source");
  const sourceText = await readEditorText(page);
  const sourceState = await page.evaluate((editorSelector) => ({
    mode: window.__app?.getMode?.() ?? null,
    contentEditable: document.querySelector(editorSelector)?.getAttribute("contenteditable"),
  }), DEBUG_EDITOR_SELECTOR);
  await switchToMode(page, "lexical");
  const after = await readEditorText(page);

  if (before !== sourceText || before !== after) {
    return { pass: false, message: "document text changed while cycling lexical/source modes" };
  }

  if (sourceState.mode !== "source" || sourceState.contentEditable !== "true") {
    return { pass: false, message: "source mode did not switch the visible editor surface to editable raw markdown" };
  }

  return { pass: true, message: "lexical/source mode switch preserved canonical markdown" };
}
