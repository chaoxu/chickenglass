import {
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "index-structure-parity";

const HEADING_MARKER = " HeadingEditNeedle";


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
    // Anchor click coordinates to the first non-padding text span — the code
    // block's `padding-top: 1.9rem` (chrome reserve for the language label)
    // means box.y is several lines above the first code line.
    const codeOrigin = await codeBlock.evaluate((element) => {
      const blockRect = element.getBoundingClientRect();
      const firstSpan = element.querySelector("span");
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      if (!firstSpan) {
        return { x: blockRect.left, y: blockRect.top, lineHeight };
      }
      const spanRect = firstSpan.getBoundingClientRect();
      return { x: spanRect.left, y: spanRect.top, lineHeight };
    });
    const lineHeight = codeOrigin.lineHeight;

    const clickResults = [];
    for (const visualLine of [2, 5, 8]) {
      await page.mouse.click(codeOrigin.x + 10, codeOrigin.y + lineHeight * (visualLine - 0.5));
      await page.waitForTimeout(150);
      // Lexical's CodeNode renders each line as inline spans separated by <br>
      // elements. Derive the clicked line by counting <br>s before the anchor
      // span — anchor text content alone has no newlines.
      const actualCodeLine = await page.evaluate(() => {
        const selection = window.getSelection();
        const anchorNode = selection?.anchorNode;
        if (!anchorNode) return -1;
        const anchorSpan = anchorNode.nodeType === 3 ? anchorNode.parentNode : anchorNode;
        const code = document.querySelectorAll("code.block")[1];
        if (!code) return -1;
        let line = 1;
        for (const child of code.childNodes) {
          if (child === anchorSpan || child.contains?.(anchorSpan)) break;
          if (child.nodeName === "BR") line += 1;
        }
        return line;
      });
      clickResults.push({ actualCodeLine, visualLine });
    }

    const longHeading = page.locator("h1.cf-lexical-heading[data-coflat-heading-number='3']").first();
    await longHeading.scrollIntoViewIfNeeded();
    // Click on a plain-text portion of the heading ("Should Stay") so the
    // cursor reveal feature doesn't swap a rich token under the caret and
    // throw off the keystrokes that follow.
    const plainTextProbe = await longHeading.evaluate((heading) => {
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const idx = node.textContent?.indexOf("Should Stay") ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx);
          const rect = range.getBoundingClientRect();
          return { x: rect.left, y: rect.top + rect.height / 2 };
        }
        node = walker.nextNode();
      }
      return null;
    });
    if (plainTextProbe) {
      await page.mouse.click(plainTextProbe.x, plainTextProbe.y);
      await page.waitForTimeout(120);
      await page.keyboard.type(HEADING_MARKER);
      await page.waitForTimeout(250);
    }

    const markdown = await readEditorText(page);
    const headingLine = markdown
      .split("\n")
      .find((line) => line.includes("A Very Long Heading With")) ?? "";

    return {
      clickResults,
      headingLine,
      headingState,
      lineHeight,
      plainTextProbeFound: Boolean(plainTextProbe),
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
    return {
      pass: false,
      message: `code-block click mapping drifted: ${JSON.stringify(value.clickResults)}`,
    };
  }

  if (!value.plainTextProbeFound) {
    return { pass: false, message: "could not locate plain-text region in long heading for click target" };
  }

  if (
    !value.rawHeadingLineHasMarker
    || !value.headingLine.startsWith("# A Very Long Heading With")
    || !value.headingLine.includes("`code`")
    || !value.headingLine.includes("[link](https://example.com)")
    || !value.headingLine.includes("[@cormen2009]")
  ) {
    return {
      pass: false,
      message: `editing long heading lost rich tokens. Line: ${JSON.stringify(value.headingLine)}`,
    };
  }

  if (!value.renderedCodeText.includes("const clickMappingLines = [")) {
    return { pass: false, message: "code block click-mapping fixture is not rendering as a code surface" };
  }

  return {
    pass: true,
    message: "heading chrome, long-heading editing, and code-block click mapping behave on index.md",
  };
}
