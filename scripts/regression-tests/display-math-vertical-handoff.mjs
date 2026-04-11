import {
  findLine,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "display-math-vertical-handoff";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const displayMathLine = await findLine(page, "$$");
  const afterDisplayLine = await findLine(
    page,
    "Backslash:",
  );

  if (displayMathLine < 0 || afterDisplayLine < 0) {
    return {
      pass: false,
      message: "missing display-math anchors in index.md",
    };
  }

  await setCursor(page, displayMathLine - 1, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });

  const states = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
    states.push(await page.evaluate(() => ({
      structure: window.__cmDebug.structure(),
      selection: window.__cmDebug.selection(),
    })));
  }

  const entered = states[0];
  if (entered.structure?.kind !== "display-math") {
    return {
      pass: false,
      message: `ArrowDown did not enter display math: ${JSON.stringify(states)}`,
    };
  }

  if ((states[1]?.selection?.line ?? 0) <= (entered.selection?.line ?? 0)) {
    return {
      pass: false,
      message: `ArrowDown did not advance within display math: ${JSON.stringify(states)}`,
    };
  }

  const exited = states[states.length - 1];
  if (exited.structure !== null) {
    return {
      pass: false,
      message: `ArrowDown stayed stuck in display math: ${JSON.stringify(states)}`,
    };
  }

  if ((exited.selection?.line ?? 0) < afterDisplayLine) {
    return {
      pass: false,
      message:
        `ArrowDown did not hand off past display math: ` +
        `${JSON.stringify({ afterDisplayLine, states })}`,
    };
  }

  return {
    pass: true,
    message:
      `ArrowDown traversed display math and resumed root motion at line ${exited.selection?.line ?? "?"}`,
  };
}
