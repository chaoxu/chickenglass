import {
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "index-structure-parity";

const HEADING_MARKER = " HeadingEditNeedle";

function lineOfOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const headingState = await page.evaluate(() => {
      const headings = [...document.querySelectorAll(".cf-lexical-heading")].map((element) => ({
        number: element.getAttribute("data-coflat-heading-number"),
        text: element.textContent?.trim() ?? "",
      }));

      const exact = (prefix) => headings.find((heading) => heading.text.startsWith(prefix)) ?? null;
      return {
        longHeading: exact("A Very Long Heading With Bold"),
        numbered: exact("Numbered Heading"),
        numberedSubsection: exact("Numbered Subsection"),
        structure: exact("Frontmatter and Structure Editing"),
        unnumbered: exact("Unnumbered Heading"),
        unnumberedSubsection: exact("Unnumbered Subsection"),
      };
    });

    const codeBlock = page.locator("code.block").nth(1);
    await codeBlock.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const codeText = await codeBlock.textContent();
    const box = await codeBlock.boundingBox();
    const lineHeight = await codeBlock.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight)
    );

    const clickResults = [];
    for (const visualLine of [2, 5, 8]) {
      await page.mouse.click((box?.x ?? 0) + 30, (box?.y ?? 0) + lineHeight * (visualLine - 0.5));
      await page.waitForTimeout(150);
      const selection = await page.evaluate(() => {
        const selection = window.getSelection();
        return {
          anchorText: selection?.anchorNode?.textContent ?? "",
          offset: selection?.anchorOffset ?? -1,
        };
      });
      clickResults.push({
        actualCodeLine: lineOfOffset(selection.anchorText, selection.offset),
        visualLine,
      });
    }

    const longHeading = page.locator("h1.cf-lexical-heading[data-coflat-heading-number='3']").first();
    await longHeading.click();
    await page.keyboard.type(HEADING_MARKER);
    await page.waitForTimeout(250);

    const markdown = await readEditorText(page);
    const headingLine = markdown
      .split("\n")
      .find((line) => line.includes("A Very Long Heading With")) ?? "";

    return {
      clickResults,
      headingLine,
      headingState,
      lineHeight,
      rawHeadingLineHasMarker: headingLine.includes(HEADING_MARKER),
      renderedCodeText: codeText ?? "",
    };
  }, {
    ignoreConsole: ["[vite] connecting...", "[vite] connected."],
    ignorePageErrors: [
      /Cache storage is disabled because the context is sandboxed/,
      /writeEmbed is not defined/,
    ],
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during structure interactions: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (value.headingState.structure?.number !== "1") {
    return { pass: false, message: "top-level section numbering did not render for the first numbered heading" };
  }

  if (value.headingState.unnumbered?.number !== null || value.headingState.unnumberedSubsection?.number !== null) {
    return { pass: false, message: "unnumbered headings still show section numbers on the Lexical surface" };
  }

  if (value.headingState.numbered?.number !== "2" || value.headingState.numberedSubsection?.number !== "2.1") {
    return { pass: false, message: "numbered heading chrome did not preserve the expected section numbers" };
  }

  if (value.clickResults.some((result) => result.actualCodeLine !== result.visualLine)) {
    return { pass: false, message: "code-block click mapping drifted away from the clicked rendered line" };
  }

  if (
    !value.rawHeadingLineHasMarker
    || !value.headingLine.startsWith("# A Very Long Heading With")
    || !value.headingLine.includes("`code`")
    || !value.headingLine.includes("[link](https://example.com)")
    || !value.headingLine.includes("[@cormen2009]")
  ) {
    return { pass: false, message: "editing the long rich heading no longer stays local to the rendered heading content" };
  }

  if (!value.renderedCodeText.includes("const clickMappingLines = [")) {
    return { pass: false, message: "code block click-mapping fixture is not rendering as a code surface" };
  }

  return {
    pass: true,
    message: "heading chrome, long-heading editing, and code-block click mapping behave on index.md",
  };
}
