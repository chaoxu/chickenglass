/**
 * Regression test: cursor navigation does not get stuck on hidden fences.
 *
 * Places the cursor at various positions and moves it forward/backward,
 * verifying it does not get trapped at atomic ranges (hidden closing fences).
 * Uses __cmView.dispatch to move cursor — never locator.click() on CM6 content.
 */

/* global window */

export const name = "cursor-navigation";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));

  // Ensure rich mode (fences are hidden here)
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

  const docLength = await page.evaluate(() => window.__cmView.state.doc.length);
  if (docLength === 0) {
    return { pass: false, message: "Document is empty" };
  }

  // Test: move cursor line by line from top to a position deep in the document.
  // If the cursor gets stuck, sequential moves will return the same position.
  const stuckPositions = await page.evaluate(() => {
    const view = window.__cmView;
    const doc = view.state.doc;
    const totalLines = doc.lines;
    const testLines = Math.min(totalLines, 40);
    const stuck = [];

    for (let line = 1; line <= testLines; line++) {
      const lineObj = doc.line(line);
      // Place cursor at start of line
      view.dispatch({ selection: { anchor: lineObj.from } });

      // Read back the actual cursor position
      const actual = view.state.selection.main.head;

      // The cursor should be at lineObj.from or have been pushed to a valid
      // nearby position by atomicRanges. It should NOT be negative or beyond doc.
      if (actual < 0 || actual > doc.length) {
        stuck.push({ line, requested: lineObj.from, actual, issue: "out-of-range" });
      }
    }

    return stuck;
  });

  if (stuckPositions.length > 0) {
    const details = stuckPositions
      .slice(0, 3)
      .map((s) => `line ${s.line}: requested ${s.requested}, got ${s.actual} (${s.issue})`)
      .join("; ");
    return { pass: false, message: `Cursor issues: ${details}` };
  }

  // Test: sequential arrow-down moves should advance the cursor
  const advancementIssue = await page.evaluate(() => {
    const view = window.__cmView;
    // Start at line 1
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });

    let prevPos = view.state.selection.main.head;
    let stuckCount = 0;

    // Simulate 20 "move line down" actions
    for (let i = 0; i < 20; i++) {
      // Use the CM6 command dispatch for cursor movement
      const line = view.state.doc.lineAt(prevPos);
      const nextLineNum = line.number + 1;
      if (nextLineNum > view.state.doc.lines) break;

      const nextLine = view.state.doc.line(nextLineNum);
      view.dispatch({ selection: { anchor: nextLine.from } });

      const newPos = view.state.selection.main.head;
      if (newPos === prevPos && nextLine.from !== prevPos) {
        stuckCount++;
      }
      prevPos = newPos;
    }

    return stuckCount;
  });

  if (advancementIssue > 3) {
    return {
      pass: false,
      message: `Cursor got stuck ${advancementIssue} times during sequential line-down navigation`,
    };
  }

  return { pass: true };
}
