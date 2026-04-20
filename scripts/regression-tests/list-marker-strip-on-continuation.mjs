/**
 * Regression: after Enter auto-continues a list, typing the list marker
 * (`- `, `* `, `+ `, or `N. `) again must NOT produce a doubled marker.
 *
 * Prior bug: Lexical's MarkdownShortcutPlugin runs element transformers only
 * when the grandparent is root/shadow-root, so the `- ` typed inside a
 * list item never triggered the UNORDERED_LIST transform and remained
 * literal text. `- one\n- two` round-tripped to `- one\n- - two`.
 *
 * Fix: a TextNode transform strips a redundant bullet/number marker when
 * a list item's first text child starts with a marker matching the parent
 * list type.
 */
export const name = "list-marker-strip-on-continuation";
export const groups = ["app"];

const CASES = [
  { label: "dash", typed: "- one\n- two", expect: "- one\n- two" },
  { label: "star", typed: "* one\n* two", expect: "* one\n* two" },
  { label: "plus", typed: "+ one\n+ two", expect: "+ one\n+ two" },
  { label: "ordered", typed: "1. one\n2. two", expect: "1. one\n2. two" },
  {
    label: "exit",
    typed: "- one\n- two\n\nafter",
    expect: "- one\n- two\n\nafter",
  },
];

export async function run(page) {
  for (const { label, typed, expect } of CASES) {
    await page.evaluate(async () => {
      if (window.__app.getCurrentDocument?.()) {
        await window.__app.closeFile({ discard: true });
      }
    });
    await page.evaluate(
      (fileName) => window.__app.openFileWithContent(fileName, ""),
      `list-${label}.md`,
    );
    await page.waitForFunction(() => Boolean(window.__editor));
    await page.evaluate(() => window.__editor.focus());
    await page.keyboard.type(typed, { delay: 30 });
    const doc = await page.evaluate(() => window.__editor.getDoc());
    if (doc !== expect) {
      return {
        pass: false,
        message: `[${label}] typing ${JSON.stringify(typed)} produced ${JSON.stringify(doc)} (expected ${JSON.stringify(expect)})`,
      };
    }
  }
  return {
    pass: true,
    message: "list markers do not double and exited lists keep following paragraphs separate",
  };
}
