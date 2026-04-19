export const name = "selection-title-labels";

const DOC = [
  "# Heading Title {#sec:heading-title}",
  "",
  "::: {.theorem} Visible Title {#thm:visible-title}",
  "Selectable body text for dragging.",
  ":::",
  "",
].join("\n");

async function openScratch(page) {
  await page.evaluate(async (text) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale cleanup between cases.
      }
    }
    app.setMode("lexical");
    await app.openFileWithContent("scratch-selection-title-labels.md", text);
  }, DOC);
  await page.waitForFunction(
    (expected) => window.__editor?.getDoc?.() === expected,
    DOC,
    { timeout: 10000 },
  );
}

async function dragSelectFirstBodyText(page) {
  const points = await page.evaluate(() => {
    const body = document.querySelector(".cf-lexical-block--theorem .cf-lexical-nested-editor--block-body");
    const walker = body ? document.createTreeWalker(body, NodeFilter.SHOW_TEXT) : null;
    const text = walker?.nextNode() ?? null;
    if (!text || !text.textContent) {
      throw new Error("missing theorem body text");
    }

    const start = document.createRange();
    start.setStart(text, 0);
    start.setEnd(text, 1);
    const startRect = start.getBoundingClientRect();

    const endOffset = Math.min(text.textContent.length, "Selectable body".length);
    const end = document.createRange();
    end.setStart(text, endOffset - 1);
    end.setEnd(text, endOffset);
    const endRect = end.getBoundingClientRect();

    return {
      endX: endRect.right,
      startX: startRect.left,
      y: (startRect.top + startRect.bottom) / 2,
    };
  });

  await page.mouse.move(points.startX, points.y);
  await page.mouse.down();
  await page.mouse.move(points.endX, points.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    () => (window.getSelection()?.toString() ?? "").includes("Selectable"),
    undefined,
    { timeout: 5000 },
  );
}

export async function run(page) {
  await openScratch(page);

  const titleState = await page.evaluate(() => {
    const heading = document.querySelector(".cf-lexical-heading");
    const title = document.querySelector(".cf-lexical-block--theorem .cf-lexical-nested-editor--title");
    return {
      doc: window.__editor?.getDoc?.() ?? "",
      headingText: heading?.textContent ?? "",
      titleText: title?.textContent ?? "",
    };
  });
  if (
    titleState.headingText.includes("{#")
    || !titleState.headingText.includes("Heading Title")
    || !titleState.doc.includes("{#sec:heading-title}")
  ) {
    return {
      pass: false,
      message: `heading label leaked or source label was lost: ${JSON.stringify(titleState)}`,
    };
  }

  if (
    titleState.titleText.includes("{#")
    || !titleState.titleText.includes("Visible Title")
    || !titleState.doc.includes("{#thm:visible-title}")
  ) {
    return {
      pass: false,
      message: `block title label leaked or source label was lost: ${JSON.stringify(titleState)}`,
    };
  }

  await dragSelectFirstBodyText(page);
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  if (!selectedText.includes("Selectable")) {
    return {
      pass: false,
      message: `drag selection collapsed inside nested editor: ${JSON.stringify(selectedText)}`,
    };
  }

  return {
    pass: true,
    message: "nested text selection survives mouseup repair and heading/block title labels stay out of rendered fields",
  };
}
