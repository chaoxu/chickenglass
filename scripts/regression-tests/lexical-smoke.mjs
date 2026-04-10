import {
  assertEditorHealth,
  openRegressionDocument,
  readEditorText,
} from "../test-helpers.mjs";

export const name = "lexical-smoke";

export async function run(page) {
  await openRegressionDocument(page);
  await assertEditorHealth(page, "lexical-smoke");
  const text = await readEditorText(page);
  const hasEditor = await page.evaluate(
    () => Boolean(document.querySelector('[data-testid="lexical-editor"]')),
  );

  if (!hasEditor) {
    return { pass: false, message: "lexical editor element did not mount" };
  }

  if (!text.includes("Coflat Feature Showcase")) {
    return { pass: false, message: "regression document did not load into the lexical surface" };
  }

  return { pass: true, message: "lexical editor loaded the showcase document" };
}
