import {
  findLine,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "fenced-body-vertical-motion";

async function captureCursor(page) {
  return page.evaluate(() => {
    const view = window.__cmView;
    const selection = view.state.selection.main;
    const coords = view.coordsAtPos(selection.head, 1)
      ?? view.coordsAtPos(selection.head, -1);
    const line = view.state.doc.lineAt(selection.head);
    return {
      head: selection.head,
      line: line.number,
      lineText: line.text,
      lineInfo: window.__cmDebug.line(line.number),
      cursorTop: coords?.top ?? null,
      cursorBottom: coords?.bottom ?? null,
      structure: window.__cmDebug.structure(),
    };
  });
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const bodyLine = await findLine(
    page,
    "This referenced block exists to test hover previews",
  );
  if (bodyLine < 0) {
    return {
      pass: false,
      message: "missing fenced-body anchor in index.md",
    };
  }

  await setCursor(page, bodyLine, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const before = await captureCursor(page);
  const wrappedHeight = Number.parseFloat(before.lineInfo?.height ?? "0");
  if (!Number.isFinite(wrappedHeight) || wrappedHeight < 48) {
    return {
      pass: false,
      message: `setup failure: fenced body line was not wrapped (${JSON.stringify(before.lineInfo)})`,
    };
  }

  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const after = await captureCursor(page);

  if (after.structure?.kind === "fenced-opener") {
    return {
      pass: false,
      message:
        `ArrowDown bounced back to the fenced opener instead of staying in the wrapped body. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  if (after.line !== before.line) {
    return {
      pass: false,
      message:
        `ArrowDown skipped wrapped fenced body line ${before.line} and landed on line ${after.line}. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  if (after.head <= before.head) {
    return {
      pass: false,
      message:
        `ArrowDown did not advance within the wrapped fenced body line. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  if (after.lineInfo?.text !== before.lineInfo?.text) {
    return {
      pass: false,
      message:
        `ArrowDown changed the wrapped fenced body segment instead of staying on the same visual line group. ` +
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    };
  }

  return {
    pass: true,
    message: `ArrowDown stayed within wrapped fenced body line ${after.line} and advanced visually`,
  };
}
