import { readEditorText } from "../test-helpers.mjs";

export const name = "embedded-field-dirty-state";
export const groups = ["surfaces"];

const DOC = `::: {#thm:embedded-dirty .theorem title="Original theorem title"}
Body text.
:::

::: {#tbl:embedded-dirty .table title="Original table caption"}
| Column |
|--------|
| Value  |
:::
`;

const TITLE_MARKER = " TitleDirtyNeedle";
const CAPTION_MARKER = " CaptionDirtyNeedle";

async function openScratchDocument(page) {
  const path = `scratch-embedded-field-dirty-${Date.now()}.md`;
  await page.evaluate(async ({ nextPath, text }) => {
    await window.__app?.closeFile?.({ discard: true });
    window.__app.setMode("lexical");
    await window.__app.openFileWithContent(nextPath, text);
  }, { nextPath: path, text: DOC });
  await page.waitForFunction(
    ({ expected, nextPath }) =>
      window.__app?.getCurrentDocument?.()?.path === nextPath &&
      window.__editor?.getDoc?.() === expected &&
      window.__app?.isDirty?.() === false,
    { expected: DOC, nextPath: path },
    { timeout: 10_000 },
  );
}

async function appendToEmbeddedField(page, fieldSelector, marker) {
  const field = page.locator(fieldSelector).first();
  await field.click();
  const editor = field.locator("[contenteditable='true']").first();
  await editor.waitFor({ state: "visible", timeout: 5000 });
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(marker);

  await page.waitForFunction(
    (needle) => window.__editor?.getDoc?.().includes(needle),
    marker,
    { timeout: 5000 },
  );

  const state = await page.evaluate((needle) => ({
    dirty: window.__app?.isDirty?.() ?? false,
    docIncludesMarker: window.__editor?.getDoc?.().includes(needle) ?? false,
  }), marker);

  if (!state.docIncludesMarker || !state.dirty) {
    throw new Error(`embedded field edit did not mark dirty after canonical update: ${JSON.stringify(state)}`);
  }
}

export async function run(page) {
  await openScratchDocument(page);

  await appendToEmbeddedField(
    page,
    "section.cf-lexical-block--theorem .cf-lexical-block-title",
    TITLE_MARKER,
  );

  const afterTitle = await readEditorText(page);
  if (!afterTitle.includes(TITLE_MARKER)) {
    return { pass: false, message: "theorem title edit did not reach canonical markdown" };
  }

  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await page.waitForFunction(() => window.__app?.isDirty?.() === false, undefined, { timeout: 5000 });

  await appendToEmbeddedField(
    page,
    "section.cf-lexical-block--table .cf-lexical-block-caption-text",
    CAPTION_MARKER,
  );

  const afterCaption = await readEditorText(page);
  if (!afterCaption.includes(CAPTION_MARKER)) {
    return { pass: false, message: "table caption edit did not reach canonical markdown" };
  }

  return {
    pass: true,
    message: "embedded title and caption edits mark the app dirty as soon as canonical markdown changes",
  };
}
