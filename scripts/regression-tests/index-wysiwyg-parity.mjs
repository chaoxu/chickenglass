import {
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "index-wysiwyg-parity";

const UPDATED_LINK = "[Link text](https://example.org)";
const UPDATED_CITATION = "[@cormen2009, p. 7]";

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const initialState = await page.evaluate(() => {
      const inlineImage = document.querySelector("img[alt='Local hover-preview figure']");
      const problemStrong = document.querySelector(".cf-lexical-block--problem .cf-lexical-block-title strong");
      const figureRef = document.querySelector("[data-coflat-ref-id='fig:pdf-local'], [data-coflat-single-ref-id='fig:pdf-local']");
      const tableRef = document.querySelector("[data-coflat-ref-id='tbl:feature-matrix'], [data-coflat-single-ref-id='tbl:feature-matrix']");

      return {
        figureRefText: figureRef?.textContent?.trim() ?? "",
        hasInlineImage: Boolean(inlineImage),
        inlineImageBlockAncestor: Boolean(inlineImage?.closest(".cf-lexical-block")),
        problemStrongText: problemStrong?.textContent?.trim() ?? "",
        tableRefText: tableRef?.textContent?.trim() ?? "",
      };
    });

    const equationRef = page.locator(
      "[data-coflat-ref-id='eq:gaussian'], [data-coflat-single-ref-id='eq:gaussian']",
    ).first();
    await equationRef.hover();
    await page.waitForTimeout(350);

    const equationPreview = await page.evaluate(
      () => document.querySelector(".cf-hover-preview-tooltip[data-visible='true']")?.textContent?.trim() ?? "",
    );

    const linkTexts = await page.locator("a.cf-lexical-link").evaluateAll((elements) =>
      elements.map((element) => element.textContent?.trim() ?? "")
    );
    const linkIndex = linkTexts.findIndex((text) => text === "Link text");
    if (linkIndex < 0) {
      throw new Error('could not find the "Link text" link in index.md');
    }
    const renderedLink = page.locator("a.cf-lexical-link").nth(linkIndex);
    await renderedLink.click();
    await page.locator(".cf-lexical-inline-token-panel-shell").waitFor({ state: "visible", timeout: 5000 });
    const linkInput = page.locator(".cf-lexical-floating-source-editor");
    await linkInput.waitFor({ state: "visible", timeout: 5000 });
    const initialLinkSource = await linkInput.inputValue();
    await linkInput.fill(UPDATED_LINK);
    await linkInput.press("Enter");
    await page.waitForTimeout(200);

    const renderedCitation = page.locator(
      ".cf-lexical-editor--rich [data-coflat-reference='true'].cf-citation",
    ).first();
    await renderedCitation.click();
    await page.locator(".cf-lexical-inline-token-panel-shell").waitFor({ state: "visible", timeout: 5000 });
    const citationInput = page.locator(".cf-lexical-inline-token-panel-editor");
    await citationInput.waitFor({ state: "visible", timeout: 5000 });
    const initialCitationSource = await citationInput.inputValue();
    await citationInput.fill(UPDATED_CITATION);
    await citationInput.press("Enter");
    await page.waitForTimeout(200);

    const markdown = await readEditorText(page);

    return {
      equationPreview,
      initialCitationSource,
      initialLinkSource,
      initialState,
      markdown,
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
      message: `runtime issues surfaced during index parity interactions: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (!value.initialState.hasInlineImage || value.initialState.inlineImageBlockAncestor) {
    return {
      pass: false,
      message: "inline markdown images still are not rendering as inline media on the Lexical surface",
    };
  }

  if (value.initialState.problemStrongText !== "3SUM") {
    return {
      pass: false,
      message: "problem block title= markdown is not rendering rich inline formatting",
    };
  }

  if (value.initialState.figureRefText !== "Figure 1" || value.initialState.tableRefText !== "Table 1") {
    return {
      pass: false,
      message: "figure/table references did not resolve to numbered labels",
    };
  }

  if (value.equationPreview.includes("{#eq:gaussian}")) {
    return {
      pass: false,
      message: "equation hover preview leaked raw label syntax instead of rendering only the equation body",
    };
  }

  if (value.initialLinkSource !== "[Link text](https://example.com)") {
    return {
      pass: false,
      message: "rendered link source reveal did not expose the raw markdown token",
    };
  }

  if (value.initialCitationSource !== "[@cormen2009]") {
    return {
      pass: false,
      message: "rendered citation source reveal did not expose the raw reference token",
    };
  }

  if (!value.markdown.includes(UPDATED_LINK)) {
    return {
      pass: false,
      message: "edited rendered link source did not flow back into canonical markdown",
    };
  }

  if (!value.markdown.includes(UPDATED_CITATION)) {
    return {
      pass: false,
      message: "edited rendered citation source did not flow back into canonical markdown",
    };
  }

  return {
    pass: true,
    message: "inline images, rich titles, equation previews, and rendered source-reveal editing behave on index.md",
  };
}
