import {
  openRegressionDocument,
  readEditorText,
} from "../test-helpers.mjs";

export const name = "public-heavy-embedded-field-immediate-save";
export const groups = ["surfaces"];

const DOCUMENT_PATH = "perf-heavy/main.md";
const TITLE_MARKER = " ImmediateSaveTitleNeedle";
const TITLE_CONTINUATION_MARKER = " ImmediateSaveTitleAfterReadNeedle";
const BODY_MARKER = " ImmediateSaveBodyNeedle";
const CELL_MARKER = " ImmediateSaveCellNeedle";

async function saveCloseAndReopen(page, path) {
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await page.evaluate(async () => {
    await window.__app.closeFile();
  });
  await page.evaluate(async (path) => {
    await window.__app.openFile(path);
  }, path);
  await page.waitForFunction(
    (path) =>
      window.__app?.getCurrentDocument?.()?.path === path &&
      (window.__editor?.getDoc?.().length ?? 0) > 70_000,
    path,
    { timeout: 10_000 },
  );
}

export async function run(page) {
  await openRegressionDocument(page, DOCUMENT_PATH, { mode: "lexical" });
  await page.waitForFunction(
    () => document.querySelectorAll(".cf-lexical-block--lemma .cf-lexical-nested-editor--title").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const title = page
    .locator(".cf-lexical-block--lemma .cf-lexical-nested-editor--title")
    .first();
  await title.scrollIntoViewIfNeeded();
  await title.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(TITLE_MARKER);
  const afterTitleRead = await readEditorText(page);
  if (!afterTitleRead.includes(TITLE_MARKER)) {
    return {
      pass: false,
      message: "active theorem title draft was not included by document read",
    };
  }
  await page.keyboard.type(TITLE_CONTINUATION_MARKER);
  await saveCloseAndReopen(page, DOCUMENT_PATH);

  const afterTitleSave = await readEditorText(page);
  if (
    !afterTitleSave.includes(TITLE_MARKER)
    || !afterTitleSave.includes(TITLE_CONTINUATION_MARKER)
  ) {
    return {
      pass: false,
      message: "active theorem title draft was lost by read/continue/save/reopen",
    };
  }

  const body = page
    .locator(".cf-lexical-block--lemma .cf-lexical-nested-editor--block-body")
    .first();
  await body.scrollIntoViewIfNeeded();
  await body.click();
  await page.keyboard.type(BODY_MARKER);
  await saveCloseAndReopen(page, DOCUMENT_PATH);

  const afterBodySave = await readEditorText(page);
  if (!afterBodySave.includes(BODY_MARKER)) {
    return {
      pass: false,
      message: "active theorem body draft was lost by immediate save/reopen",
    };
  }

  await openRegressionDocument(page, "index.md", { mode: "lexical" });
  const tableCell = page
    .locator(".cf-lexical-table-block tbody td .cf-lexical-paragraph")
    .first();
  await tableCell.scrollIntoViewIfNeeded();
  await tableCell.click();
  await page.keyboard.type(CELL_MARKER);
  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await page.evaluate(async () => {
    await window.__app.closeFile();
  });
  await page.evaluate(async () => {
    await window.__app.openFile("index.md");
  });
  await page.waitForFunction(
    () =>
      window.__app?.getCurrentDocument?.()?.path === "index.md" &&
      (window.__editor?.getDoc?.().length ?? 0) > 1_000,
    undefined,
    { timeout: 10_000 },
  );

  const afterCellSave = await readEditorText(page);
  if (!afterCellSave.includes(CELL_MARKER)) {
    return {
      pass: false,
      message: "active table-cell draft was lost by immediate save/reopen",
    };
  }

  return {
    pass: true,
    message: "active embedded title/body/cell drafts flush before document read and save",
  };
}
