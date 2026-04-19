import { openRegressionDocument, readEditorText } from "../test-helpers.mjs";

export const name = "reference-autocomplete";

async function placeVisibleCaretAtEnd(page) {
  const placed = await page.evaluate(() => {
    const editor = document.querySelector(".cf-lexical-editor--rich[contenteditable='true']");
    if (!(editor instanceof HTMLElement)) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let lastTextNode = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent?.length ?? 0) > 0) {
        lastTextNode = node;
      }
    }

    if (!(lastTextNode instanceof Text)) {
      return false;
    }

    const range = document.createRange();
    range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
    range.collapse(true);
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  });

  if (!placed) {
    throw new Error("failed to place a visible caret at the end of the Lexical rich surface");
  }

  await page.waitForTimeout(150);
}

async function waitForReferenceCompletion(page) {
  await page.locator(".cf-reference-completion-tooltip").waitFor({ state: "visible", timeout: 5000 });
}

async function readCompletionOptions(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".cf-reference-completion-preview")].map((item) =>
      item.textContent?.replace(/\s+/g, " ").trim() ?? "")
  );
}

async function pickCompletionOption(page, needle) {
  const option = page.locator(".cf-reference-completion-preview").filter({ hasText: needle }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  await page.waitForTimeout(200);
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });
  await placeVisibleCaretAtEnd(page);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bracketed [@");
  await waitForReferenceCompletion(page);

  const bracketedOptions = await readCompletionOptions(page);
  if (!bracketedOptions.some((option) => option.includes("thm:hover-preview"))) {
    return {
      pass: false,
      message: `bracketed @ completion is missing theorem labels: ${JSON.stringify(bracketedOptions)}`,
    };
  }
  if (!bracketedOptions.some((option) => option.includes("cormen2009"))) {
    return {
      pass: false,
      message: `bracketed @ completion is missing citation keys: ${JSON.stringify(bracketedOptions)}`,
    };
  }

  await pickCompletionOption(page, "thm:hover-preview");
  const afterBracketed = await readEditorText(page);
  if (!afterBracketed.includes("Bracketed [@thm:hover-preview")) {
    return {
      pass: false,
      message: "bracketed autocomplete did not insert the selected cross-reference id",
    };
  }

  await page.keyboard.type("] and narrative @");
  await waitForReferenceCompletion(page);

  const narrativeOptions = await readCompletionOptions(page);
  if (!narrativeOptions.some((option) => option.includes("cormen2009"))) {
    return {
      pass: false,
      message: `narrative @ completion is missing citation keys: ${JSON.stringify(narrativeOptions)}`,
    };
  }

  await pickCompletionOption(page, "cormen2009");
  const afterNarrative = await readEditorText(page);
  if (!afterNarrative.includes("narrative @cormen2009")) {
    return {
      pass: false,
      message: "narrative autocomplete did not insert the selected citation id",
    };
  }

  const citationCountBeforeManual = await page.evaluate(() =>
    document.querySelectorAll("[data-coflat-citation='true']").length
  );
  await page.keyboard.type(" and manual [@cormen2009]");
  await page.waitForFunction(
    (previousCount) =>
      document.querySelectorAll("[data-coflat-citation='true']").length > previousCount,
    citationCountBeforeManual,
    { timeout: 5000 },
  ).catch(() => {});
  const afterManual = await readEditorText(page);
  const citationCountAfterManual = await page.evaluate(() =>
    document.querySelectorAll("[data-coflat-citation='true']").length
  );
  if (
    !afterManual.includes("manual [@cormen2009]")
    || citationCountAfterManual <= citationCountBeforeManual
  ) {
    return {
      pass: false,
      message: "manually typed bracketed citation did not become a rendered citation token",
    };
  }

  return {
    pass: true,
    message: "visible Lexical typing opens @ completion and manual bracketed citations render",
  };
}
