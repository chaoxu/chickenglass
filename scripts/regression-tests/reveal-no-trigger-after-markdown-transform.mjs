/**
 * Regression: typing `**bold** done.` must round-trip to exactly that
 * markdown. Prior bug: InlineCursorReveal fired on SELECTION_CHANGE_COMMAND
 * right after MarkdownShortcutPlugin applied the bold transform, replacing
 * the freshly-created bold text node with its raw source. Subsequent
 * keystrokes ended up inside the closing markers, serializing to
 * `**bold done.**` with escaped asterisks.
 */
import { readEditorText } from "../test-helpers.mjs";

export const name = "reveal-no-trigger-after-markdown-transform";

const CASES = [
  { name: "bold", typed: "**bold** done.", expect: "**bold** done." },
  { name: "italic", typed: "*em* word.", expect: "*em* word." },
  { name: "code", typed: "use `x+y` here", expect: "use `x+y` here" },
  { name: "math", typed: "eq $a+b$ here", expect: "eq $a+b$ here" },
];

export async function run(page) {
  for (const { name: label, typed, expect } of CASES) {
    await page.evaluate(async () => {
      if (window.__app.getCurrentDocument?.()) {
        await window.__app.closeFile({ discard: true });
      }
    });
    await page.evaluate((fileName) =>
      window.__app.openFileWithContent(fileName, ""), `${label}.md`);
    await page.waitForFunction(() => Boolean(window.__editor));
    await page.evaluate(() => window.__editor.focus());
    await page.keyboard.type(typed, { delay: 30 });
    const doc = await readEditorText(page);
    if (doc !== expect) {
      return {
        pass: false,
        message: `typing ${JSON.stringify(typed)} produced ${JSON.stringify(doc)} (expected ${JSON.stringify(expect)})`,
      };
    }
  }
  return {
    pass: true,
    message: "markdown transforms survive SELECTION_CHANGE without reveal hijacking",
  };
}
