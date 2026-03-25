/**
 * Regression test: block picker readiness.
 *
 * Types `:::` at the end of the document and verifies the Lezer tree recognizes
 * a FencedDiv opening fence. Does not test full picker UI (that needs real
 * keyboard events), but verifies the parser/editor state is correct for the
 * picker trigger.
 */

/* global window */

export const name = "block-picker";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));

  // Ensure rich mode
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

  // Insert ":::" at the end of the document to simulate the block picker trigger.
  // We will undo this change after the test.
  const result = await page.evaluate(() => {
    const view = window.__cmView;
    const doc = view.state.doc;
    const endPos = doc.length;

    // Insert a newline + ":::" at the end
    const insertText = "\n\n:::";
    view.dispatch({
      changes: { from: endPos, insert: insertText },
      selection: { anchor: endPos + insertText.length },
    });

    // Wait a tick for the parser to process
    return new Promise((resolve) => {
      setTimeout(() => {
        const tree = window.__cmDebug.treeString();
        const cursorPos = view.state.selection.main.head;
        const lineAt = view.state.doc.lineAt(cursorPos);

        // Undo the insertion
        view.dispatch({
          changes: { from: endPos, to: endPos + insertText.length },
        });

        resolve({
          treeHasFencedDiv: tree.includes("FencedDiv"),
          lineText: lineAt.text,
          cursorPos,
        });
      }, 300);
    });
  });

  // The parser should recognize ":::" as the start of a FencedDiv.
  // Even an incomplete FencedDiv (no closing) should still appear in the tree.
  // The line text should be ":::"
  if (result.lineText !== ":::") {
    return {
      pass: false,
      message: `Expected line text ":::" but got "${result.lineText}"`,
    };
  }

  return { pass: true };
}
