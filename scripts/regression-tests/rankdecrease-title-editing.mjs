import {
  openRegressionDocument,
  readEditorText,
} from "../test-helpers.mjs";

export const name = "rankdecrease-title-editing";
export const groups = ["surfaces"];

const TITLE_MARKER = "RankDecreaseTitleNeedle";

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md", { mode: "lexical" });

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
    line.includes("Weighted ratio equals parallel-closure ratio")) ?? "";

  if (!titleLine.includes(TITLE_MARKER)) {
    return {
      pass: false,
      message: `rankdecrease block title typing did not survive focus activation. Title line: ${JSON.stringify(titleLine)}`,
    };
  }

  return {
    pass: true,
    message: "rankdecrease focus-activated block title accepts continuous typing and commits on blur",
  };
}
