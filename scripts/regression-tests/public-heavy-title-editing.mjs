import {
  openRegressionDocument,
  readEditorText,
} from "../test-helpers.mjs";

export const name = "public-heavy-title-editing";
export const groups = ["surfaces"];

const TITLE_MARKER = "PublicHeavyTitleNeedle";

export async function run(page) {
  await openRegressionDocument(page, "perf-heavy/main.md", { mode: "lexical" });

  const title = page
    .locator(".cf-lexical-block--lemma .cf-lexical-nested-editor--title")
    .first();
  await title.scrollIntoViewIfNeeded();
  await title.click();
  await page.waitForTimeout(180);
  await page.keyboard.press("Meta+A");
  await page.waitForTimeout(80);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(80);
  await page.keyboard.type(` ${TITLE_MARKER}`);
  await page.waitForTimeout(180);

  await page
    .locator(".cf-lexical-block--lemma .cf-lexical-nested-editor--block-body")
    .first()
    .click();
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    TITLE_MARKER,
    { timeout: 7000 },
  ).catch(() => {});

  const text = await readEditorText(page);
  const titleLine = text.split("\n").find((line) =>
    line.includes(".lemma") && line.includes(TITLE_MARKER)) ?? "";

  if (!titleLine.includes(TITLE_MARKER)) {
    return {
      pass: false,
      message: `public heavy block title typing did not survive focus activation. Title line: ${JSON.stringify(titleLine)}`,
    };
  }

  return {
    pass: true,
    message: "public heavy focus-activated block title accepts continuous typing and commits on blur",
  };
}
