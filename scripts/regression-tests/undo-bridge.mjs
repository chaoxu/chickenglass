import { openRegressionDocument, readEditorText, sleep, switchToMode } from "../test-helpers.mjs";

export const name = "undo-bridge";
export const groups = ["authoring", "navigation"];

/**
 * Regression coverage for Issue #100: edits made inside a rich surface (table
 * cell) and in a plain paragraph must both be undoable, and the undo must
 * propagate through the editor-session bridge so `window.__editor.getDoc()`
 * and the save path observe the reverted markdown.
 */
export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "lexical");
  await sleep(500);

  const before = await readEditorText(page);

  // --- Step 1: edit in a table cell, then undo.
  const focusedCell = await page.evaluate(() => {
    const paras = [...document.querySelectorAll(".cf-lexical-table-block p.cf-lexical-paragraph")];
    if (paras.length === 0) return false;
    const target = paras[0];
    const textNode = target.firstChild?.firstChild ?? target.firstChild;
    if (textNode?.nodeType === Node.TEXT_NODE) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.setEnd(textNode, textNode.length);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    target.closest("[contenteditable='true']").focus();
    return true;
  });
  if (!focusedCell) {
    return { pass: false, message: "no table-cell paragraph available in fixture" };
  }
  await sleep(200);

  await page.keyboard.type("T");
  await sleep(300);
  const afterCellType = await readEditorText(page);
  if (afterCellType === before) {
    return { pass: false, message: "cell type did not propagate through bridge" };
  }

  await page.keyboard.press("Meta+z");
  await sleep(400);
  const afterCellUndo = await readEditorText(page);
  if (afterCellUndo !== before) {
    return {
      pass: false,
      message: `cell undo did not match original doc (delta=${afterCellUndo.length - before.length})`,
    };
  }

  // --- Step 2: edit a non-table paragraph, then undo.
  const focusedPara = await page.evaluate(() => {
    const paras = [...document.querySelectorAll("[contenteditable='true'] p.cf-lexical-paragraph")];
    const target = paras.find((p) => !p.closest(".cf-lexical-table-block"));
    if (!target) return false;
    const textNode = target.lastChild;
    const sel = window.getSelection();
    const range = document.createRange();
    if (textNode?.nodeType === Node.TEXT_NODE) {
      range.setStart(textNode, textNode.textContent.length);
      range.setEnd(textNode, textNode.textContent.length);
    } else {
      range.selectNodeContents(target);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    target.closest("[contenteditable='true']").focus();
    return true;
  });
  if (!focusedPara) {
    return { pass: false, message: "no non-table paragraph available in fixture" };
  }
  await sleep(200);

  const beforePara = await readEditorText(page);
  await page.keyboard.type("ZZZ");
  await sleep(300);
  const afterParaType = await readEditorText(page);
  if (!afterParaType.includes("ZZZ")) {
    return { pass: false, message: "paragraph type did not land in doc bridge" };
  }

  await page.keyboard.press("Meta+z");
  await sleep(400);
  const afterParaUndo = await readEditorText(page);
  if (afterParaUndo !== beforePara) {
    return {
      pass: false,
      message: `paragraph undo did not match pre-type doc (delta=${afterParaUndo.length - beforePara.length})`,
    };
  }
  if (afterParaUndo.includes("ZZZ")) {
    return { pass: false, message: "ZZZ still present in doc after undo" };
  }

  return {
    pass: true,
    message: "table-cell and paragraph undo round-trip through doc bridge",
  };
}
