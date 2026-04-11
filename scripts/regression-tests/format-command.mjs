import {
  openFixtureDocument,
  readEditorText,
  setSelection,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "format-command";

const FIXTURE = {
  virtualPath: "format-command.md",
  displayPath: "fixture:format-command.md",
  content: "Alpha Beta\n",
};

async function selectVisibleRichText(page, text) {
  const selected = await page.evaluate((nextText) => {
    const root = document.querySelector(".cf-lexical-editor--rich");
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (!(current instanceof Text)) {
        continue;
      }
      const value = current.textContent ?? "";
      const index = value.indexOf(nextText);
      if (index < 0) {
        continue;
      }

      const selection = window.getSelection();
      if (!selection) {
        return false;
      }

      const range = document.createRange();
      range.setStart(current, index);
      range.setEnd(current, index + nextText.length);
      root.focus();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    return false;
  }, text);

  await page.waitForTimeout(100);
  return selected;
}

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });

  if (!(await selectVisibleRichText(page, "Beta"))) {
    return { pass: false, message: "fixture text missing the visible lexical selection target" };
  }

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("cf:format", {
      detail: { type: "bold" },
    }));
  });
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
  const alphaEnd = alphaStart + "Alpha".length;
  if (alphaStart < 0) {
    return { pass: false, message: "source-mode selection target disappeared after rich formatting" };
  }

  await setSelection(page, alphaStart, alphaEnd);
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("cf:format", {
      detail: { type: "italic" },
    }));
  });
  await page.waitForTimeout(150);

  const sourceReformatted = await readEditorText(page);
  if (sourceReformatted !== "*Alpha* **Beta**\n") {
    return { pass: false, message: `source format event updated the wrong canonical markdown: ${JSON.stringify(sourceReformatted)}` };
  }

  return { pass: true, message: "format events rewrite markdown through the Lexical surface" };
}
