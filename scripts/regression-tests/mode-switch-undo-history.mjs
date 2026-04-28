/**
 * Regression test: CM6 undo history survives switching through Lexical mode.
 */

import {
  getHistoryState,
  openEditorScenario,
  readEditorText,
  settleEditorLayout,
  switchToMode,
  waitForDocumentStable,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "mode-switch-undo-history";

const FIXTURE = {
  virtualPath: "mode-switch-undo-history.md",
  displayPath: "generated:mode-switch-undo-history.md",
  content: "",
};

async function cm6History(page) {
  return getHistoryState(page);
}

async function insertInActiveEditor(page, text) {
  await page.evaluate((insertText) => {
    const editor = window.__editor;
    if (!editor?.focus || !editor?.insertText) {
      throw new Error("window.__editor insert bridge is unavailable");
    }
    editor.focus();
    editor.insertText(insertText);
  }, text);
  await waitForDocumentStable(page, { quietMs: 200, timeoutMs: 5_000 });
}

export async function run(page) {
  await openEditorScenario(page, {
    entry: FIXTURE.virtualPath,
    files: {
      [FIXTURE.virtualPath]: FIXTURE.content,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cf-doc-flow--cm6" },
  });

  await insertInActiveEditor(page, "AAA");
  await insertInActiveEditor(page, "BBB");
  await insertInActiveEditor(page, "CCC");

  const beforeSwitch = await cm6History(page);
  if (!beforeSwitch || beforeSwitch.undoDepth < 1) {
    return {
      pass: false,
      message: `expected CM6 undo history before mode switch, got ${JSON.stringify(beforeSwitch)}`,
    };
  }

  await switchToMode(page, "lexical");
  await waitForRenderReady(page, {
    selector: ".cf-doc-flow--lexical",
    frameCount: 3,
    delayMs: 64,
  });
  await switchToMode(page, "cm6-rich");
  await waitForRenderReady(page, {
    selector: ".cf-doc-flow--cm6",
    frameCount: 3,
    delayMs: 64,
  });
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });

  const afterSwitch = await cm6History(page);
  if (!afterSwitch || afterSwitch.undoDepth < beforeSwitch.undoDepth) {
    return {
      pass: false,
      message:
        `CM6 undo history was not restored: before=${JSON.stringify(beforeSwitch)}, ` +
        `after=${JSON.stringify(afterSwitch)}`,
    };
  }

  await page.evaluate(() => window.__cmView?.focus?.());
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForDocumentStable(page, { quietMs: 200, timeoutMs: 5_000 });

  const docAfterUndo = await readEditorText(page);
  if (docAfterUndo === "AAABBBCCC") {
    return {
      pass: false,
      message: `Cmd/Ctrl+Z did not change the document after history restore; history=${JSON.stringify(afterSwitch)}`,
    };
  }

  return {
    pass: true,
    message:
      `restored CM6 undo history across Lexical mode switch and undo changed ` +
      `${"AAABBBCCC".length} chars to ${docAfterUndo.length}`,
  };
}
