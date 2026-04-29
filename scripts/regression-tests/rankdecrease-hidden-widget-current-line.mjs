import {
  clearMotionGuards,
  clearStructure,
  getSelectionState,
  getStructureState,
  openRegressionDocument,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "rankdecrease-hidden-widget-current-line";
export const optionalFixtures = true;

async function runProbe(page, { direction, line, maxLineDelta }) {
  await clearStructure(page);
  await clearMotionGuards(page);
  await setCursor(page, line, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const previous = await getSelectionState(page);
  await page.keyboard.press(direction === "down" ? "ArrowDown" : "ArrowUp");
  await settleEditorLayout(page, { frameCount: 2, delayMs: 64 });
  const current = await getSelectionState(page);
  const structure = await getStructureState(page);
  const lineDelta = current.line - previous.line;

  if (direction === "down" && lineDelta < 0) {
    return {
      pass: false,
      message: `ArrowDown moved backward while activating hidden widget: ${JSON.stringify({ previous, current, structure })}`,
    };
  }
  if (direction === "up" && lineDelta > 0) {
    return {
      pass: false,
      message: `ArrowUp moved forward while activating hidden widget: ${JSON.stringify({ previous, current, structure })}`,
    };
  }
  if (Math.abs(lineDelta) > maxLineDelta) {
    return {
      pass: false,
      message: `${direction} jumped too far while activating hidden widget: ${JSON.stringify({ previous, current, structure, lineDelta })}`,
    };
  }
  if (!structure) {
    return {
      pass: false,
      message: `${direction} did not activate the hidden widget at line ${line}: ${JSON.stringify({ previous, current })}`,
    };
  }
  return {
    pass: true,
    message: `${direction} activated ${structure.kind} near line ${line} without a line jump`,
  };
}

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md");
  await switchToMode(page, "rich");

  const displayMathResult = await runProbe(page, {
    direction: "down",
    line: 780,
    maxLineDelta: 1,
  });
  if (!displayMathResult.pass) return displayMathResult;

  const frontmatterResult = await runProbe(page, {
    direction: "up",
    line: 34,
    maxLineDelta: 1,
  });
  if (!frontmatterResult.pass) return frontmatterResult;

  return {
    pass: true,
    message: `${displayMathResult.message}; ${frontmatterResult.message}`,
  };
}
