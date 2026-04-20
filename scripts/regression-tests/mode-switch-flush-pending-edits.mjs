import {
  DEBUG_EDITOR_SELECTOR,
  openFixtureDocument,
  readEditorText,
  setRevealPresentation,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "mode-switch-flush-pending-edits";
export const groups = ["app", "reveal"];

const INLINE_FIXTURE = {
  virtualPath: "mode-switch-inline.md",
  displayPath: "fixture:mode-switch-inline.md",
  content: "A $x$ B\n",
};

async function readSourceSurfaceText(page) {
  return page.evaluate((editorSelector) =>
    document.querySelector(editorSelector)?.textContent ?? "",
  DEBUG_EDITOR_SELECTOR);
}

export async function run(page) {
  await setRevealPresentation(page, "inline");
  await openFixtureDocument(page, INLINE_FIXTURE, { mode: "lexical" });

  const inlineDoc = await readEditorText(page);
  const afterInlineBody = inlineDoc.indexOf("$x$") + 2;
  await page.evaluate((offset) => {
    window.__editor.setSelection(offset, offset);
  }, afterInlineBody);
  await waitForBrowserSettled(page);
  await page.waitForFunction(
    () => [...document.querySelectorAll("[data-lexical-text='true']")]
      .some((node) => node.textContent === "$x$" && node.style.getPropertyValue("--cf-reveal")),
    undefined,
    { timeout: 10000 },
  );
  await page.keyboard.type("2");
  await waitForBrowserSettled(page);

  await switchToMode(page, "source");
  const sourceDoc = await readEditorText(page);
  const sourceSurfaceText = await readSourceSurfaceText(page);
  if (!sourceDoc.includes("A $x2$ B") || !sourceSurfaceText.includes("A $x2$ B")) {
    return {
      pass: false,
      message: `active inline reveal edit did not flush into source mode: ${JSON.stringify({ sourceDoc, sourceSurfaceText })}`,
    };
  }
  const expectedSelection = sourceDoc.indexOf("$x2$") + 3;
  await page.waitForFunction(
    (expected) => window.__editor.getSelection().anchor === expected,
    expectedSelection,
    { timeout: 5000 },
  );
  const sourceSelection = await page.evaluate(() => window.__editor.getSelection());
  if (sourceSelection.anchor !== expectedSelection || sourceSelection.focus !== expectedSelection) {
    return {
      pass: false,
      message: `inline reveal source offset was not preserved on mode switch: ${JSON.stringify(sourceSelection)} expected ${expectedSelection}`,
    };
  }

  return {
    pass: true,
    message: "pending inline reveal edits flush before mode boundaries and preserve source selection",
  };
}
