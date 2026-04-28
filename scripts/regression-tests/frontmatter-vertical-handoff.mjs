import {
  clearMotionGuards,
  clearStructure,
  getSelectionState,
  getStructureState,
  openRegressionDocument,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "frontmatter-vertical-handoff";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "rich");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  await page.evaluate(() => {
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  });
  await clearStructure(page);
  await clearMotionGuards(page);
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });

  const states = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
    const [structure, selection] = await Promise.all([
      getStructureState(page),
      getSelectionState(page),
    ]);
    states.push({ structure, selection });
  }

  if (states[0]?.structure?.kind !== "frontmatter") {
    return {
      pass: false,
      message: `ArrowDown did not enter frontmatter structure edit: ${JSON.stringify(states)}`,
    };
  }

  for (let i = 1; i < 5; i += 1) {
    const previousLine = states[i - 1]?.selection?.line ?? 0;
    const currentLine = states[i]?.selection?.line ?? 0;
    if (currentLine <= previousLine) {
      return {
        pass: false,
        message:
          `ArrowDown did not advance within frontmatter between moves ${i} and ${i + 1}: ` +
          `${JSON.stringify(states)}`,
      };
    }
  }

  const exited = states[states.length - 1];
  if (exited.structure !== null) {
    return {
      pass: false,
      message: `ArrowDown stayed stuck in frontmatter: ${JSON.stringify(states)}`,
    };
  }

  if ((exited.selection?.line ?? 0) < 6) {
    return {
      pass: false,
      message:
        `ArrowDown did not hand off to the document body after frontmatter: ` +
        `${JSON.stringify(states)}`,
    };
  }

  return {
    pass: true,
    message: `ArrowDown traversed frontmatter and resumed root motion at line ${exited.selection?.line ?? "?"}`,
  };
}
