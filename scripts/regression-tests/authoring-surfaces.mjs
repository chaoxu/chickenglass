import {
  openRegressionDocument,
  withRuntimeIssueCapture,
  formatRuntimeIssues,
} from "../test-helpers.mjs";

export const name = "authoring-surfaces";

export async function run(page) {
  await openRegressionDocument(page, "index.md");

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const frontmatterToggle = page.locator(".cf-lexical-structure-toggle--frontmatter").first();
    await frontmatterToggle.click();
    await page.waitForTimeout(150);

    const hasFrontmatterSourceEditor = await page.evaluate(() =>
      Boolean(document.querySelector(
        ".cf-lexical-structure-source-editor--frontmatter[contenteditable='true']",
      ))
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    const displayMath = page.locator(".cf-lexical-display-math-body").first();
    await displayMath.click();
    await page.waitForTimeout(150);

    const hasDisplayMathSourceEditor = await page.evaluate(() =>
      Boolean(document.querySelector(
        ".cf-lexical-structure-source-editor--math[contenteditable='true']",
      ))
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    const blockToggle = page.locator(".cf-lexical-block .cf-lexical-structure-toggle").first();
    await blockToggle.click();
    await page.waitForTimeout(150);

    const hasBlockOpenerEditor = await page.evaluate(() =>
      Boolean(document.querySelector(
        ".cf-lexical-structure-source-editor--opener[contenteditable='true']",
      ))
    );

    return {
      hasFrontmatterSourceEditor,
      hasDisplayMathSourceEditor,
      hasBlockOpenerEditor,
    };
  }, {
    ignoreConsole: ["[vite] connecting...", "[vite] connected."],
    ignorePageErrors: [
      /Cache storage is disabled because the context is sandboxed/,
    ],
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during authoring checks: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (!value.hasFrontmatterSourceEditor) {
    return {
      pass: false,
      message: "frontmatter YAML did not open from the title shell",
    };
  }

  if (!value.hasDisplayMathSourceEditor) {
    return {
      pass: false,
      message: "display math did not open as an inline markdown source editor",
    };
  }

  if (!value.hasBlockOpenerEditor) {
    return {
      pass: false,
      message: "semantic block opener did not open as an inline markdown source editor",
    };
  }

  return {
    pass: true,
    message: "frontmatter, display math, and block openers reveal inline markdown source on the visible Lexical surface",
  };
}
