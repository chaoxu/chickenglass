import {
  focusEditor,
  openFixtureDocument,
  readEditorText,
  saveCurrentFile,
  setSelection,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "save-flow";
export const groups = ["app"];

const FIXTURE = {
  virtualPath: "save-flow.md",
  displayPath: "fixture:save-flow.md",
  content: "# Save Flow\n\nParagraph.\n",
};

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });
  const original = await readEditorText(page);
  await setSelection(page, original.indexOf("Paragraph.") + "Paragraph.".length);
  await focusEditor(page);
  await page.keyboard.type("\n\nAppended line.");
  await waitForBrowserSettled(page, 3);

  const dirtyBeforeSave = await page.evaluate(() => window.__app?.isDirty?.() ?? false);
  if (!dirtyBeforeSave) {
    return { pass: false, message: "editor did not become dirty after inserting text" };
  }

  await saveCurrentFile(page);

  const savedText = await readEditorText(page);
  const dirtyAfterSave = await page.evaluate(() => window.__app?.isDirty?.() ?? true);

  if (dirtyAfterSave) {
    return { pass: false, message: "editor stayed dirty after save" };
  }

  if (!savedText.endsWith("Appended line.\n")) {
    return { pass: false, message: "saved document is missing the appended text" };
  }

  return { pass: true, message: "save cleared dirty state and kept lexical edits" };
}
