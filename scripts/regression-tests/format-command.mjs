import {
  DEBUG_EDITOR_SELECTOR,
  formatSelection,
  openFixtureDocument,
  readEditorText,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "format-command";
export const groups = ["authoring"];

const FIXTURE = {
  virtualPath: "format-command.md",
  displayPath: "fixture:format-command.md",
  content: "Alpha Beta\n",
};

async function selectVisibleText(page, text) {
  return page.evaluate(({ editorSelector, needle }) => {
    const root = document.querySelector(`${editorSelector}[contenteditable='true']`);
    if (!root) {
      return false;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = (node.textContent ?? "").indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.focus();
        root.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        return true;
      }
      node = walker.nextNode();
    }
    return false;
  }, { editorSelector: DEBUG_EDITOR_SELECTOR, needle: text });
}

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });

  if (!await selectVisibleText(page, "Beta")) {
    return { pass: false, message: "fixture text missing the visible lexical selection target" };
  }

  await formatSelection(page, { type: "bold" });
  await page.waitForTimeout(150);

  const richFormatted = await readEditorText(page);
  if (richFormatted !== "Alpha **Beta**\n") {
    return { pass: false, message: `rich format event updated the wrong document text: ${JSON.stringify(richFormatted)}` };
  }

  await switchToMode(page, "source");
  const sourceFormatted = await readEditorText(page);
  if (sourceFormatted !== richFormatted) {
    return { pass: false, message: "source mode does not match rich-mode canonical markdown after bold formatting" };
  }

  const alphaStart = sourceFormatted.indexOf("Alpha");
  if (alphaStart < 0 || !await selectVisibleText(page, "Alpha")) {
    return { pass: false, message: "fixture text missing the source selection target" };
  }
  await formatSelection(page, { type: "italic" });
  await page.waitForTimeout(150);

  const sourceModeFormatted = await readEditorText(page);
  if (sourceModeFormatted !== "*Alpha* **Beta**\n") {
    return { pass: false, message: `source format event updated the wrong document text: ${JSON.stringify(sourceModeFormatted)}` };
  }

  return { pass: true, message: "format commands rewrite markdown through the Lexical surface" };
}
