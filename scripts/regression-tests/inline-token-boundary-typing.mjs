import {
  discardCurrentFile,
  focusEditor,
  openRegressionDocument,
  readEditorText,
  setSelection,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "inline-token-boundary-typing";
export const groups = ["authoring", "reveal"];

async function openScratch(page, path, content = "") {
  await discardCurrentFile(page);
  await page.evaluate(async ({ nextPath, nextContent }) => {
    window.__app.setMode("lexical");
    await window.__app.openFileWithContent(nextPath, nextContent);
  }, { nextPath: path, nextContent: content });
  await page.waitForFunction(
    (nextPath) => window.__app?.getCurrentDocument?.()?.path === nextPath,
    path,
    { timeout: 10_000 },
  );
  await focusEditor(page);
}

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md", { mode: "lexical" });

  await openScratch(page, "rankdecrease/inline-token-plain-typing.md");
  await page.keyboard.type("x");
  await waitForBrowserSettled(page, 3);
  const plainDoc = await readEditorText(page);
  if (plainDoc !== "x") {
    return {
      pass: false,
      message: `plain printable typing was not immediately canonical: ${JSON.stringify(plainDoc)}`,
    };
  }

  await openScratch(page, "rankdecrease/inline-token-after-math.md");
  await page.keyboard.type("$M$");
  await waitForBrowserSettled(page, 3);
  await page.keyboard.type("1");
  await waitForBrowserSettled(page, 3);
  const paragraphDoc = await readEditorText(page);
  if (paragraphDoc !== "$M$1") {
    return {
      pass: false,
      message: `typing after inline math in a paragraph was not canonical: ${JSON.stringify(paragraphDoc)}`,
    };
  }

  await openScratch(page, "rankdecrease/inline-token-non-boundary-typing.md", "a $M$");
  await setSelection(page, 0);
  await page.keyboard.type("x");
  await waitForBrowserSettled(page, 3);
  const nonBoundaryDoc = await readEditorText(page);
  if (nonBoundaryDoc !== "xa $M$") {
    return {
      pass: false,
      message: `typing away from an inline token was hijacked by boundary handling: ${JSON.stringify(nonBoundaryDoc)}`,
    };
  }

  await openScratch(
    page,
    "rankdecrease/inline-token-after-nested-math.md",
    "::: {.theorem} Boundary\nBody\n:::",
  );
  const theoremBody = page.locator(".cf-lexical-nested-editor--block-body").first();
  await theoremBody.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" $M$1");
  await waitForBrowserSettled(page, 3);
  const nestedDoc = await readEditorText(page);
  if (!nestedDoc.includes("Body $M$1")) {
    return {
      pass: false,
      message: `typing after inline math in a nested block was not canonical: ${JSON.stringify(nestedDoc)}`,
    };
  }

  await openScratch(page, "rankdecrease/inline-token-after-table-math.md");
  await page.keyboard.type("| A | B |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("| --- | --- |");
  await page.keyboard.press("Enter");
  await waitForBrowserSettled(page, 6);
  await page.keyboard.type("$M$");
  await waitForBrowserSettled(page, 3);
  await page.keyboard.press("Tab");
  await page.keyboard.type("1");
  await waitForBrowserSettled(page, 3);
  const tableDoc = await readEditorText(page);
  if (!tableDoc.includes("| $M$ | 1 |")) {
    return {
      pass: false,
      message: `typing after inline math plus Tab in table cells was not canonical: ${JSON.stringify(tableDoc)}`,
    };
  }

  await openScratch(page, "rankdecrease/inline-token-after-reference.md");
  await page.keyboard.type("[@Vardy97]");
  await waitForBrowserSettled(page, 3);
  await page.keyboard.type("x");
  await waitForBrowserSettled(page, 3);
  const referenceDoc = await readEditorText(page);
  if (referenceDoc !== "[@Vardy97]x") {
    return {
      pass: false,
      message: `typing after a reference token was not canonical: ${JSON.stringify(referenceDoc)}`,
    };
  }

  return {
    pass: true,
    message: "typing after inline tokens and tabbing across table cells stays canonical",
  };
}
