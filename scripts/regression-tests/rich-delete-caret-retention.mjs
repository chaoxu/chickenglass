import { focusEditor, readEditorText } from "../test-helpers.mjs";

export const name = "rich-delete-caret-retention";

const DOC = [
  "Alpha bravo charlie delta.",
  "",
  "Second paragraph to keep.",
  "",
  "Third paragraph.",
].join("\n");

async function openScratch(page, path, doc, mode) {
  await page.evaluate(async ({ nextPath, nextDoc, nextMode }) => {
    await window.__app.closeFile?.({ discard: true });
    await window.__app.openFileWithContent(nextPath, nextDoc);
    window.__app.setMode(nextMode);
  }, {
    nextDoc: doc,
    nextMode: mode,
    nextPath: path,
  });
  await page.waitForFunction(
    ({ expected, expectedMode }) =>
      window.__editor?.getDoc?.() === expected && window.__app?.getMode?.() === expectedMode,
    {
      expected: doc,
      expectedMode: mode,
    },
    { timeout: 10000 },
  );
}

function selectVisibleText(page, needle) {
  return page.evaluate((targetText) => {
    const root = document.querySelector('[data-testid="lexical-editor"]');
    if (!root) {
      throw new Error("missing editor root");
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const start = text.indexOf(targetText);
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + targetText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        return true;
      }
      node = walker.nextNode();
    }

    return false;
  }, needle);
}

export async function run(page) {
  await openScratch(page, "scratch-rich-delete-caret.md", DOC, "lexical");
  await focusEditor(page);

  const deletedText = "bravo ";
  const deletionOffset = DOC.indexOf(deletedText);
  const selected = await selectVisibleText(page, deletedText);
  if (!selected) {
    return { pass: false, message: "could not select the rich prose text to delete" };
  }

  await page.keyboard.press("Backspace");
  const expectedAfterDelete = DOC.replace(deletedText, "");
  await page.waitForFunction(
    (expected) => window.__editor?.getDoc?.() === expected,
    expectedAfterDelete,
    { timeout: 5000 },
  );

  const selectionAfterDelete = await page.evaluate(() => window.__editor.getSelection());
  if (
    selectionAfterDelete.anchor !== deletionOffset
    || selectionAfterDelete.focus !== deletionOffset
  ) {
    return {
      pass: false,
      message: `delete left source selection at ${JSON.stringify(selectionAfterDelete)}, expected ${deletionOffset}`,
    };
  }

  await page.waitForTimeout(250);
  await page.keyboard.type("kept ");
  const text = await readEditorText(page);
  if (!text.startsWith("Alpha kept charlie")) {
    return {
      pass: false,
      message: `typing after delete did not stay at the deletion point: ${JSON.stringify(text.slice(0, 40))}`,
    };
  }

  const sourceSwitchDoc = "Alpha\n\nSecond";
  await openScratch(page, "scratch-source-rich-caret.md", sourceSwitchDoc, "source");
  await page.evaluate(() => window.__editor.setSelection(9));
  await page.evaluate(() => window.__app.setMode("lexical"));
  await page.waitForFunction(
    () => window.__app?.getMode?.() === "lexical",
    undefined,
    { timeout: 5000 },
  );
  await focusEditor(page);
  await page.keyboard.type("X");
  const sourceSwitchText = await readEditorText(page);
  if (sourceSwitchText !== "Alpha\n\nSeXcond") {
    return {
      pass: false,
      message: `source-to-rich mode switch did not preserve caret before typing: ${JSON.stringify(sourceSwitchText)}`,
    };
  }

  const sourceMathDoc = "Alpha $x+1$ bravo\n";
  await openScratch(page, "scratch-source-rich-inline-math.md", sourceMathDoc, "source");
  await page.evaluate((doc) => window.__editor.setSelection(doc.indexOf("x+1") + 1), sourceMathDoc);
  await page.evaluate(() => window.__app.setMode("lexical"));
  await page.waitForFunction(
    () => window.__app?.getMode?.() === "lexical",
    undefined,
    { timeout: 5000 },
  );
  await focusEditor(page);
  await page.keyboard.type("2");
  const sourceMathText = await readEditorText(page);
  if (sourceMathText !== "Alpha $x2+1$ bravo\n") {
    return {
      pass: false,
      message: `source-to-rich mode switch did not restore inside inline math reveal: ${JSON.stringify(sourceMathText)}`,
    };
  }

  const blankLineDoc = "Alpha\n\nSecond";
  await openScratch(page, "scratch-blank-source-offset.md", blankLineDoc, "lexical");
  await page.evaluate(() => window.__editor.setSelection(6));
  await focusEditor(page);
  await page.keyboard.type("B");
  const blankLineText = await readEditorText(page);
  if (blankLineText !== "Alpha\n\nBSecond") {
    return {
      pass: false,
      message: `blank-line source offset did not map to the nearest editable rich position: ${JSON.stringify(blankLineText)}`,
    };
  }

  const formattedDoc = "Alpha **bravo** charlie";
  await openScratch(page, "scratch-formatted-source-offset.md", formattedDoc, "lexical");
  await page.evaluate((doc) => window.__editor.setSelection(doc.indexOf("bravo") + 2), formattedDoc);
  await focusEditor(page);
  await page.keyboard.type("X");
  const formattedText = await readEditorText(page);
  if (formattedText !== "Alpha **brXavo** charlie") {
    return {
      pass: false,
      message: `formatted source offset did not preserve the active text mark: ${JSON.stringify(formattedText)}`,
    };
  }

  const rawBlockDoc = [
    "Before",
    "",
    "$$",
    "x",
    "$$",
    "",
    "After target text.",
  ].join("\n");
  await openScratch(page, "scratch-raw-block-nearby-navigation.md", rawBlockDoc, "lexical");
  await page.evaluate((doc) => window.__editor.setSelection(doc.indexOf("target") + 3), rawBlockDoc);
  await focusEditor(page);
  await page.keyboard.type("X");
  const rawBlockText = await readEditorText(page);
  if (!rawBlockText.includes("tarXget text")) {
    return {
      pass: false,
      message: `source offset in prose after raw block selected the wrong block: ${JSON.stringify(rawBlockText)}`,
    };
  }

  return {
    pass: true,
    message: "rich prose deletion and source-offset navigation keep typing at the intended rich position",
  };
}
