/**
 * Regression test: ArrowDown should move through wrapped visual lines inside a
 * paragraph before jumping to the next document line.
 */

import {
  getLineInfo,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "wrapped-paragraph-vertical-motion";

async function captureCursor(page) {
  const cursor = await page.evaluate(() => {
    const view = window.__cmView;
    const selection = view.state.selection.main;
    const coords = view.coordsAtPos(selection.head, 1)
      ?? view.coordsAtPos(selection.head, -1);
    const line = view.state.doc.lineAt(selection.head);
    return {
      head: selection.head,
      line: line.number,
      lineText: line.text,
      cursorTop: coords?.top ?? null,
      cursorBottom: coords?.bottom ?? null,
    };
  });
  return {
    ...cursor,
    lineInfo: await getLineInfo(page, cursor.line),
  };
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  await setCursor(page, 6, 0);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const before = await captureCursor(page);
  const wrappedHeight = Number.parseFloat(before.lineInfo?.height ?? "0");
  if (!Number.isFinite(wrappedHeight) || wrappedHeight < 48) {
    return {
      pass: false,
      message: `setup failure: line 6 was not wrapped in rich mode (${JSON.stringify(before.lineInfo)})`,
    };
  }

  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const after = await captureCursor(page);

  if (after.line !== before.line) {
    return {
      pass: false,
      message:
        `ArrowDown skipped wrapped paragraph line ${before.line} and landed on line ${after.line}. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  if (after.head <= before.head) {
    return {
      pass: false,
      message:
        `ArrowDown did not advance within the wrapped line. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  if (
    typeof before.cursorTop !== "number" ||
    typeof after.cursorTop !== "number" ||
    after.cursorTop <= before.cursorTop
  ) {
    return {
      pass: false,
      message:
        `ArrowDown did not move to a lower visual line. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  return {
    pass: true,
    message: `ArrowDown stayed within wrapped paragraph line ${after.line} and advanced visually`,
  };
}
