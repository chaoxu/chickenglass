import {
  readEditorText,
  setSelection,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "source-rich-nested-offsets";

const DOC = [
  "Before",
  "",
  "| A | B |",
  "|---|---|",
  "| left | right |",
  "",
  "::: {.figure #fig:nested-offset} A caption with math $x$",
  "![Alt](missing.png)",
  ":::",
  "",
  "Alpha [^note] omega",
  "",
  "[^note]: Footnote body alpha.",
  "",
  "After",
  "",
].join("\n");

let scratchCounter = 0;

async function openScratchSourceDocument(page) {
  const path = `scratch-source-rich-nested-offsets-${Date.now()}-${scratchCounter++}.md`;
  await page.evaluate(async ({ path, text }) => {
    await window.__app?.closeFile?.({ discard: true });
    await window.__app.openFileWithContent(path, text);
  }, { path, text: DOC });
  await page.waitForFunction(
    (expectedPath) =>
      window.__app?.getCurrentDocument?.()?.path === expectedPath &&
      window.__editor?.getDoc?.().includes("Footnote body alpha."),
    path,
    { timeout: 10_000 },
  );
  await switchToMode(page, "source");
  return readEditorText(page);
}

async function typeAtSourceNeedle(page, needle, offsetInNeedle, marker) {
  const doc = await openScratchSourceDocument(page);
  const needleStart = doc.indexOf(needle);
  if (needleStart < 0) {
    throw new Error(`source needle not found: ${needle}`);
  }
  const sourceOffset = needleStart + offsetInNeedle;
  await setSelection(page, sourceOffset, sourceOffset);
  await switchToMode(page, "lexical");
  await waitForBrowserSettled(page);
  await page.waitForFunction(
    (expectedOffset) => {
      const selection = window.__editor?.getSelection?.();
      return selection?.anchor === expectedOffset && selection.focus === expectedOffset;
    },
    sourceOffset,
    { timeout: 5000 },
  );
  await page.keyboard.type(marker);
  await waitForBrowserSettled(page);
  return readEditorText(page);
}

export async function run(page) {
  const tableDoc = await typeAtSourceNeedle(page, "right", 2, "T");
  if (!tableDoc.includes("| left | riTght |")) {
    return { pass: false, message: "source-to-rich table-cell offset did not edit the target body cell" };
  }

  const captionDoc = await typeAtSourceNeedle(page, "caption", 3, "C");
  if (!captionDoc.includes("A capCtion with math $x$")) {
    return { pass: false, message: "source-to-rich caption offset did not edit the figure caption" };
  }

  const footnoteLabelDoc = await typeAtSourceNeedle(page, "[^note]:", 3, "L");
  if (!footnoteLabelDoc.includes("[^nLote]: Footnote body alpha.")) {
    return { pass: false, message: "source-to-rich footnote label offset did not edit the definition label" };
  }

  const footnoteBodyDoc = await typeAtSourceNeedle(page, "body alpha", 5, "B");
  if (!footnoteBodyDoc.includes("[^note]: Footnote body Balpha.")) {
    return { pass: false, message: "source-to-rich footnote body offset did not edit the definition body" };
  }

  return {
    pass: true,
    message: "source-to-rich offsets target table cells, captions, and footnote definitions",
  };
}
