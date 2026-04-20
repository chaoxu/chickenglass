import {
  readEditorText,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "active-nested-source-switch";
export const groups = ["surfaces"];

async function openScratch(page, label, doc) {
  const path = `scratch-active-nested-source-${label}-${Date.now()}.md`;
  await page.evaluate(async ({ path, text }) => {
    await window.__app?.closeFile?.({ discard: true });
    window.__app.setMode("lexical");
    await window.__app.openFileWithContent(path, text);
  }, { path, text: doc });
  await page.waitForFunction(
    ({ expectedPath, text }) =>
      window.__app?.getCurrentDocument?.()?.path === expectedPath &&
      window.__editor?.getDoc?.() === text,
    { expectedPath: path, text: doc },
    { timeout: 10_000 },
  );
}

async function switchToSourceState(page) {
  await switchToMode(page, "source");
  await waitForBrowserSettled(page);
  return page.evaluate(() => ({
    doc: window.__editor?.getDoc?.() ?? "",
    selection: window.__editor?.getSelection?.() ?? null,
  }));
}

export async function run(page) {
  await openScratch(page, "display", "Before\n\n$$\nx+1\n$$\n\nAfter\n");
  await page.locator(".cf-lexical-display-math-body").first().click();
  const mathEditor = page
    .locator(".cf-lexical-display-math.is-editing .cf-lexical-structure-source-editor--math")
    .first();
  await mathEditor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("$$\nx+1+2\n$$");
  await waitForBrowserSettled(page);
  const displayState = await switchToSourceState(page);
  const displayOffset = displayState.doc.indexOf("x+1+2");
  if (
    !displayState.doc.includes("x+1+2")
    || !displayState.selection
    || displayState.selection.anchor <= displayOffset
  ) {
    return {
      pass: false,
      message: `active display math switch lost content or caret locality: ${JSON.stringify(displayState)}`,
    };
  }

  await openScratch(page, "table", "| A | B |\n|---|---|\n| x | y |\n");
  await page.locator(".cf-lexical-table-block tbody td .cf-lexical-paragraph").first().click();
  await page.keyboard.type("Z");
  await waitForBrowserSettled(page);
  const tableBeforeSwitch = await readEditorText(page);
  const tableState = await switchToSourceState(page);
  if (
    !tableBeforeSwitch.includes("Z")
    || tableState.doc !== tableBeforeSwitch
    || !tableState.selection
    || tableState.selection.anchor < tableState.doc.indexOf("Z")
  ) {
    return {
      pass: false,
      message: `active table-cell switch showed stale source or wrong caret: ${JSON.stringify({ tableBeforeSwitch, tableState })}`,
    };
  }

  await openScratch(page, "theorem", '::: {.theorem title="T"}\nBody text.\n:::\n');
  await page
    .locator("section.cf-lexical-block--theorem .cf-lexical-nested-editor--block-body")
    .first()
    .click();
  await page.keyboard.type("Z");
  await waitForBrowserSettled(page);
  const theoremBeforeSwitch = await readEditorText(page);
  const theoremState = await switchToSourceState(page);
  if (
    !theoremBeforeSwitch.includes("Z")
    || theoremState.doc !== theoremBeforeSwitch
    || !theoremState.selection
    || theoremState.selection.anchor === 0
  ) {
    return {
      pass: false,
      message: `active theorem-body switch showed stale source or wrong caret: ${JSON.stringify({ theoremBeforeSwitch, theoremState })}`,
    };
  }

  return {
    pass: true,
    message: "active display math, table, and theorem edits switch to fresh source with local caret",
  };
}
