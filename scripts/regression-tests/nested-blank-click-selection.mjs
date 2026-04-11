import { readEditorText } from "../test-helpers.mjs";

export const name = "nested-blank-click-selection";

const MARKER = "BlankClickNeedle";
const DOC = `::: {.theorem} Test
Alpha

Omega
:::
`;

export async function run(page) {
  await page.evaluate(async (doc) => {
    await window.__app.openFileWithContent("scratch-blank-click.md", doc);
    window.__app.setMode("lexical");
  }, DOC);
  await page.waitForFunction(
    () => Boolean(document.querySelector(".cf-lexical-block--theorem .cf-lexical-nested-editor--block-body")),
    { timeout: 5000 },
  );
  await page.waitForTimeout(200);

  const body = page
    .locator(".cf-lexical-block--theorem .cf-lexical-nested-editor--block-body")
    .first();
  const box = await body.boundingBox();
  if (!box) {
    return { pass: false, message: "the nested theorem body did not render" };
  }

  await page.mouse.click(box.x + box.width - 8, box.y + 10);
  await page.waitForTimeout(150);
  await page.keyboard.type(` ${MARKER}`);
  await page.waitForTimeout(250);

  const text = await readEditorText(page);
  if (!text.includes(`Alpha ${MARKER}`)) {
    return {
      pass: false,
      message: "blank click near the first nested paragraph did not keep typing anchored to that paragraph",
    };
  }
  if (text.includes(`Omega ${MARKER}`)) {
    return {
      pass: false,
      message: "blank click in the first nested paragraph teleported typing to the later paragraph",
    };
  }

  return {
    pass: true,
    message: "blank clicks in nested rich surfaces keep typing near the clicked paragraph",
  };
}
