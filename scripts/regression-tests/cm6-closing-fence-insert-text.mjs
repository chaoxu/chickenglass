/**
 * Regression test: CM6 rich bridge typing continues after rendered closing
 * fences. Closing-fence atomic ranges must not trap the cursor after the fence.
 */

import {
  openEditorScenario,
  readEditorText,
  settleEditorLayout,
  waitForDocumentStable,
} from "../test-helpers.mjs";

export const name = "cm6-closing-fence-insert-text";

const TYPED_DOC = [
  "before",
  "$$",
  "x^2",
  "$$",
  "after math",
  "",
  "::: {.theorem #thm:typing}",
  "body",
  ":::",
  "after div",
  "",
  "```js",
  "console.log('x')",
  "```",
  "after code",
  "",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "cm6-closing-fence-insert-text.md",
    files: {
      "cm6-closing-fence-insert-text.md": "",
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cm-content" },
  });

  const result = await page.evaluate(async (text) => {
    const editor = window.__editor;
    await editor.ready;
    editor.setSelection(0, 0);
    editor.focus();

    const waitForFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    for (const char of text) {
      const before = editor.getDoc();
      const selectionBefore = editor.getSelection();
      editor.insertText(char);
      await waitForFrame();
      const after = editor.getDoc();
      const selectionAfter = editor.getSelection();
      if (after.length !== before.length + char.length) {
        return {
          ok: false,
          char,
          before,
          after,
          selectionBefore,
          selectionAfter,
        };
      }
    }

    return {
      ok: true,
      doc: editor.getDoc(),
      selection: editor.getSelection(),
    };
  }, TYPED_DOC);

  await settleEditorLayout(page, { frameCount: 3, delayMs: 32 });
  await waitForDocumentStable(page, { quietMs: 200, timeoutMs: 5_000 });

  const finalDoc = await readEditorText(page);
  if (!result.ok || finalDoc !== TYPED_DOC) {
    return {
      pass: false,
      message: `bridge typing stopped at closing fence: ${JSON.stringify({ result, finalDoc })}`,
    };
  }

  return {
    pass: true,
    message: `typed ${finalDoc.length} chars through math, div, and code closing fences`,
  };
}
