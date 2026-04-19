import {
  focusEditor,
  openRegressionDocument,
  readEditorText,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "native-step-authoring";

const PATH = "rankdecrease/native-step-authoring.md";

function assertAuthoring(condition, message, details) {
  if (!condition) {
    throw new Error(details ? `${message}: ${JSON.stringify(details)}` : message);
  }
}

async function clickLastTopLevelParagraph(page) {
  const point = await page.evaluate(() => {
    const paragraphs = [
      ...document.querySelectorAll(".cf-lexical-editor--rich[contenteditable='true'] > .cf-lexical-paragraph"),
    ];
    const paragraph = paragraphs.at(-1);
    if (!(paragraph instanceof HTMLElement)) {
      return null;
    }
    paragraph.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = paragraph.getBoundingClientRect();
    return {
      x: rect.left + 10,
      y: rect.top + Math.max(10, rect.height / 2),
    };
  });
  assertAuthoring(point, "could not locate trailing paragraph");
  await page.mouse.click(point.x, point.y);
  await waitForBrowserSettled(page, 3);
}

export async function run(page) {
  await openRegressionDocument(page, "rankdecrease/main.md", { mode: "lexical" });
  await page.evaluate(async (path) => {
    await window.__app.openFileWithContent(path, "");
  }, PATH);
  await page.waitForFunction(
    (path) => window.__app?.getCurrentDocument?.()?.path === path,
    PATH,
    { timeout: 10_000 },
  );
  await focusEditor(page);

  await page.keyboard.type("# Native step authoring {#sec:native-step}");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("This paragraph introduces $M$ and cites [@Vardy97].");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".cf-lexical-display-math.is-editing .cf-lexical-structure-source-editor--math")),
    undefined,
    { timeout: 5_000 },
  );
  await page.keyboard.type("\\rho(M)=\\lambda(M)/\\sigma(M)");
  await clickLastTopLevelParagraph(page);

  await page.keyboard.type("::: {.theorem #thm:native-step} Native Step Theorem");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => Boolean(document.activeElement?.closest(".cf-lexical-nested-editor--block-body")),
    undefined,
    { timeout: 5_000 },
  );
  await page.keyboard.type("Let $M$ be a matroid. The native theorem body remains editable.");
  await clickLastTopLevelParagraph(page);

  await page.keyboard.type("::: {.proof}");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => Boolean(document.activeElement?.closest(".cf-lexical-nested-editor--block-body")),
    undefined,
    { timeout: 5_000 },
  );
  await page.keyboard.type("The proof edits $\\lambda_w$ and $\\sigma_w$ inside the block body.");
  await clickLastTopLevelParagraph(page);

  await page.keyboard.type("| Object | Value |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("| :--- | ---: |");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => {
      const selection = window.getSelection();
      const anchorElement = selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const cell = anchorElement?.closest("td");
      return Boolean(cell && Array.from(cell.parentElement?.children ?? []).indexOf(cell) === 0);
    },
    undefined,
    { timeout: 5_000 },
  );
  await page.keyboard.type("$M$");
  await page.keyboard.press("Tab");
  await page.keyboard.type("1");
  await page.waitForFunction(
    () => window.__editor?.getDoc?.().includes("| $M$ | 1 |"),
    undefined,
    { timeout: 5_000 },
  );
  await waitForBrowserSettled(page, 4);

  const beforeSave = await readEditorText(page);
  for (const needle of [
    "# Native step authoring",
    "[@Vardy97]",
    "\\rho(M)=\\lambda(M)/\\sigma(M)",
    "::: {.theorem #thm:native-step} Native Step Theorem",
    "native theorem body remains editable",
    "::: {.proof}",
    "The proof edits $\\lambda_w$ and $\\sigma_w$ inside the block body.",
    "| $M$ | 1 |",
  ]) {
    assertAuthoring(beforeSave.includes(needle), "native step authoring content missing before save", {
      needle,
    });
  }

  const richState = await page.evaluate(() => ({
    blockCount: document.querySelectorAll(".cf-lexical-block").length,
    displayMathCount: document.querySelectorAll(".cf-lexical-display-math").length,
    headingLabelLeak: [...document.querySelectorAll(".cf-lexical-heading")]
      .map((node) => node.textContent ?? "")
      .find((text) => text.includes("{#")) ?? null,
    inlineMathCount: document.querySelectorAll(".cf-lexical-inline-math").length,
    referenceCount: document.querySelectorAll("[data-coflat-reference='true']").length,
    tableCount: document.querySelectorAll("table").length,
  }));
  assertAuthoring(richState.headingLabelLeak === null, "heading label leaked", richState);
  assertAuthoring(richState.inlineMathCount >= 4, "inline math did not render", richState);
  assertAuthoring(richState.displayMathCount >= 1, "display math did not render", richState);
  assertAuthoring(richState.blockCount >= 2, "theorem/proof blocks did not render", richState);
  assertAuthoring(richState.referenceCount >= 1, "citation did not render", richState);
  assertAuthoring(richState.tableCount >= 1, "table did not render", richState);

  await page.evaluate(async () => {
    await window.__app.saveFile();
  });
  await page.evaluate(async () => {
    await window.__app.closeFile();
  });
  await page.evaluate(async (path) => {
    await window.__app.openFile(path);
  }, PATH);
  await page.waitForFunction(
    (path) =>
      window.__app?.getCurrentDocument?.()?.path === path &&
      window.__editor?.getDoc?.().includes("Native Step Theorem"),
    PATH,
    { timeout: 10_000 },
  );
  const afterReopen = await readEditorText(page);
  assertAuthoring(afterReopen.includes("| $M$ | 1 |"), "native step article lost table cells after save/reopen");

  return {
    pass: true,
    message: "keyboard-authored math/citation/theorem/proof/table article saves and reopens",
  };
}
