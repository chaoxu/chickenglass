import {
  formatRuntimeIssues,
  openRegressionDocument,
  switchToMode,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "focus-command-surfaces";
export const groups = ["navigation"];

async function openScratchDocument(page, path, content) {
  await page.evaluate(async ({ nextContent, nextPath }) => {
    if (!window.__app?.openFileWithContent) {
      throw new Error("window.__app.openFileWithContent is unavailable");
    }
    if (window.__app.getCurrentDocument?.()) {
      await window.__app.closeFile({ discard: true });
    }
    await window.__app.openFileWithContent(nextPath, nextContent);
  }, {
    nextContent: content,
    nextPath: path,
  });
  await page.waitForTimeout(250);
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "lexical");

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const richBlockTitle = page
      .locator(".cf-lexical-block-title", { hasText: "Main Result" })
      .first();
    await richBlockTitle.click({ position: { x: 6, y: 6 } });
    await page.waitForTimeout(200);

    const titleFocus = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return {
        activeInsideTitle: Boolean(activeElement?.closest(".cf-lexical-block-title")),
        hasEditableTitle: Boolean(
          document.querySelector(".cf-lexical-block-title [contenteditable='true']"),
        ),
      };
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    await openScratchDocument(page, "focus-command.md", '::: {.theorem title="Focus Command"}');
    await switchToMode(page, "lexical");

    const paragraph = page
      .locator(".cf-lexical-editor--rich[contenteditable='true'] > .cf-lexical-paragraph", {
        hasText: '::: {.theorem title="Focus Command"}',
      })
      .first();
    await paragraph.click();
    await page.waitForTimeout(120);
    await page.keyboard.press("End");
    await page.waitForTimeout(80);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);

    const expansionFocus = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return {
        activeInsideBlockBody: Boolean(activeElement?.closest(".cf-lexical-block-body")),
        hasEditableBlockBody: Boolean(
          document.querySelector(".cf-lexical-block-body [contenteditable='true']"),
        ),
      };
    });

    return {
      expansionFocus,
      titleFocus,
    };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during focus command checks: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (!value.titleFocus.hasEditableTitle || !value.titleFocus.activeInsideTitle) {
    return {
      pass: false,
      message: "clicking a focus-on-demand rich block title did not move focus into the nested title editor",
    };
  }

  if (!value.expansionFocus.hasEditableBlockBody || !value.expansionFocus.activeInsideBlockBody) {
    return {
      pass: false,
      message: "markdown expansion did not transfer focus into the inserted block body editor",
    };
  }

  return {
    pass: true,
    message: "focus-on-demand embedded fields and markdown expansion both hand focus to the intended lexical surface",
  };
}
