import {
  openRegressionDocument,
  withRuntimeIssueCapture,
  formatRuntimeIssues,
} from "../test-helpers.mjs";

export const name = "authoring-surfaces";
export const groups = ["authoring", "surfaces"];

export async function run(page) {
  await openRegressionDocument(page, "index.md");

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const frontmatterToggle = page.locator(".cf-lexical-structure-toggle--frontmatter").first();
    await frontmatterToggle.click();
    await page.waitForTimeout(150);

    const frontmatterBeforeSwitch = await page.evaluate(() =>
      document.querySelectorAll(
        ".cf-lexical-structure-source-editor--frontmatter[contenteditable='true']",
      ).length
    );

    const blockToggle = page.locator(".cf-lexical-block .cf-lexical-structure-toggle").first();
    await blockToggle.click();
    await page.waitForTimeout(150);

    const crossBlockSwitch = await page.evaluate(() => ({
      blockOpenerEditors: document.querySelectorAll(
        ".cf-lexical-structure-source-editor--opener[contenteditable='true']",
      ).length,
      frontmatterEditors: document.querySelectorAll(
        ".cf-lexical-structure-source-editor--frontmatter[contenteditable='true']",
      ).length,
    }));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    const displayMath = page.locator(".cf-lexical-display-math-body").first();
    await displayMath.click();
    await page.waitForTimeout(150);

    const mathBeforeBlur = await page.evaluate(() =>
      document.querySelectorAll(
        ".cf-lexical-structure-source-editor--math[contenteditable='true']",
      ).length
    );

    const blurTarget = page.locator(
      ".cf-lexical-editor--rich[contenteditable='true'] > .cf-lexical-paragraph",
      { hasText: "Use this file to check the stable-shell behavior itself:" },
    ).first();
    await blurTarget.click();
    await page.waitForTimeout(150);

    const mathAfterBlur = await page.evaluate(() =>
      document.querySelectorAll(
        ".cf-lexical-structure-source-editor--math[contenteditable='true']",
      ).length
    );

    const gistBlock = page.locator(".cf-lexical-block--gist").first();
    await gistBlock.locator(".cf-lexical-block-label").click();
    await page.waitForTimeout(150);

    const embedBeforeSwitch = await page.evaluate(() => ({
      embedEditors: document.querySelectorAll(
        ".cf-lexical-block--gist .cf-lexical-structure-source-editor--embed[contenteditable='true']",
      ).length,
      openerEditors: document.querySelectorAll(
        ".cf-lexical-block--gist .cf-lexical-structure-source-editor--opener[contenteditable='true']",
      ).length,
    }));

    await gistBlock.locator(".cf-lexical-embed-link").click();
    await page.waitForTimeout(150);

    const embedSwitch = await page.evaluate(() => ({
      embedEditors: document.querySelectorAll(
        ".cf-lexical-block--gist .cf-lexical-structure-source-editor--embed[contenteditable='true']",
      ).length,
      openerEditors: document.querySelectorAll(
        ".cf-lexical-block--gist .cf-lexical-structure-source-editor--opener[contenteditable='true']",
      ).length,
    }));

    return {
      crossBlockSwitch,
      embedSwitch,
      embedBeforeSwitch,
      frontmatterBeforeSwitch,
      mathAfterBlur,
      mathBeforeBlur,
    };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during authoring checks: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (value.frontmatterBeforeSwitch !== 1) {
    return {
      pass: false,
      message: "frontmatter YAML did not open from the title shell before the cross-block handoff",
    };
  }

  if (value.crossBlockSwitch.frontmatterEditors !== 0 || value.crossBlockSwitch.blockOpenerEditors !== 1) {
    return {
      pass: false,
      message: "structure-edit did not hand off cleanly from frontmatter to a block opener",
    };
  }

  if (value.mathBeforeBlur !== 1 || value.mathAfterBlur !== 0) {
    return {
      pass: false,
      message: "display-math source editing did not close when focus left the active block",
    };
  }

  if (value.embedBeforeSwitch.openerEditors !== 1 || value.embedBeforeSwitch.embedEditors !== 0) {
    return {
      pass: false,
      message: "embed opener editing did not open before switching to the URL editor",
    };
  }

  if (value.embedSwitch.openerEditors !== 0 || value.embedSwitch.embedEditors !== 1) {
    return {
      pass: false,
      message: "embed blocks did not switch from opener editing to URL editing within the same block",
    };
  }

  return {
    pass: true,
    message: "structure-edit surfaces hand off cleanly across blocks, collapse on blur, and switch correctly within embed blocks",
  };
}
