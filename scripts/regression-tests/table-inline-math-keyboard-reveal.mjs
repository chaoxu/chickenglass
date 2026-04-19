import { readEditorText, waitForBrowserSettled } from "../test-helpers.mjs";

export const name = "table-inline-math-keyboard-reveal";

const DOC = [
  "| A | B |",
  "|---|---|",
  "| left | $x+1$ tail |",
  "",
].join("\n");

export async function run(page) {
  await page.evaluate(async (text) => {
    await window.__app?.closeFile?.({ discard: true });
    window.__app.setMode("lexical");
    await window.__app.openFileWithContent(`scratch-table-math-reveal-${Date.now()}.md`, text);
  }, DOC);
  await page.waitForFunction(
    () => window.__editor?.getDoc?.().includes("$x+1$ tail"),
    undefined,
    { timeout: 10_000 },
  );

  await page
    .locator(".cf-lexical-table-block tbody td")
    .filter({ hasText: "x+1" })
    .locator(".katex")
    .first()
    .click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("2");
  await waitForBrowserSettled(page);

  const text = await readEditorText(page);
  if (!text.includes("$x+21$ tail")) {
    return {
      pass: false,
      message: `table-cell inline math reveal leaked outside the math token: ${JSON.stringify(text)}`,
    };
  }

  return {
    pass: true,
    message: "keyboard entry into table-cell inline math reveal edits the math source",
  };
}
