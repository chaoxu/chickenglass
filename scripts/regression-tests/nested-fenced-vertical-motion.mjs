import {
  clearMotionGuards,
  clearStructure,
  findLine,
  getMotionGuards,
  getSelectionState,
  getStructureState,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "nested-fenced-vertical-motion";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const outerAnchorLine = await findLine(page, "Hover Preview Stress Test");
  const beforeInnerBlockquoteLine = await findLine(
    page,
    "Third list item with an equation reference [@eq:gaussian]",
  );

  if (outerAnchorLine < 0 || beforeInnerBlockquoteLine < 0) {
    return {
      pass: false,
      message: "missing nested fenced-div anchors in index.md",
    };
  }

  await setCursor(page, beforeInnerBlockquoteLine + 1, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
  });
  await clearStructure(page);
  await clearMotionGuards(page);
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
  await page.keyboard.press("ArrowDown");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const [structure, selection, motionGuards] = await Promise.all([
    getStructureState(page),
    getSelectionState(page),
    getMotionGuards(page),
  ]);
  const result = { structure, selection, motionGuards };

  if (result.structure?.kind !== "fenced-opener") {
    return {
      pass: false,
      message: `ArrowDown did not enter fenced opener: ${JSON.stringify(result)}`,
    };
  }

  if (result.structure.className !== "blockquote") {
    return {
      pass: false,
      message:
        `ArrowDown entered wrong fenced block: ` +
        `${JSON.stringify({ structure: result.structure, selection: result.selection })}`,
    };
  }

  if ((result.selection?.line ?? 0) < beforeInnerBlockquoteLine + 1) {
    return {
      pass: false,
      message:
        `ArrowDown moved upward instead of entering the inner blockquote: ` +
        `${JSON.stringify(result)}`,
    };
  }

  if ((result.selection?.line ?? 0) <= outerAnchorLine) {
    return {
      pass: false,
      message:
        `ArrowDown jumped back toward the outer theorem opener: ` +
        `${JSON.stringify(result)}`,
    };
  }

  return {
    pass: true,
    message:
      `ArrowDown entered the inner ${result.structure.className} opener ` +
      `at line ${result.selection?.line ?? "?"} without moving upward`,
  };
}
