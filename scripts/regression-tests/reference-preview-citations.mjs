import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "reference-preview-citations";

function visiblePreviewText(page) {
  return page.evaluate(
    () => document.querySelector(".cf-hover-preview-tooltip[data-visible='true']")?.textContent?.trim() ?? "",
  );
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const richText = await page.locator(".cf-lexical-editor--rich").textContent();
  if (!richText?.includes("[1]")) {
    return { pass: false, message: "citation text did not render as a numbered citation" };
  }

  const displayMathOverflow = await page.evaluate(() => {
    const equationBody = document.querySelector(".cf-lexical-display-math-body");
    if (!(equationBody instanceof HTMLElement)) {
      return null;
    }
    const styles = window.getComputedStyle(equationBody);
    return {
      overflowX: styles.overflowX,
      overflowY: styles.overflowY,
    };
  });
  if (!displayMathOverflow) {
    return { pass: false, message: "display math surface did not render" };
  }
  if (displayMathOverflow.overflowY !== "hidden") {
    return { pass: false, message: "display math surface still allows vertical scrolling" };
  }

  const bibliography = await page.locator(".cf-bibliography").textContent().catch(() => "");
  if (!bibliography.includes("Introduction to Algorithms")) {
    return { pass: false, message: "bibliography section did not render the cited entry" };
  }

  const citationAnchors = await page.evaluate(() =>
    [...document.querySelectorAll("[data-coflat-citation='true']")].slice(0, 5).map((el) => el.id),
  );
  if (citationAnchors.some((id) => !id.startsWith("cite-ref-"))) {
    return { pass: false, message: "citation backlinks did not get real in-document anchors" };
  }

  const citation = page.locator(".cf-citation").first();
  await citation.hover();
  await page.waitForTimeout(250);
  const citationPreview = await visiblePreviewText(page);
  if (!citationPreview.includes("Introduction to Algorithms")) {
    return { pass: false, message: "citation hover preview did not show bibliography content" };
  }

  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
  const theoremRef = page.locator("[data-coflat-ref-id='thm:hover-preview']").first();
  await theoremRef.scrollIntoViewIfNeeded();
  await theoremRef.hover();
  await page.waitForTimeout(250);

  const theoremPreview = await visiblePreviewText(page);
  if (!theoremPreview.includes("Hover Preview Stress Test")) {
    return { pass: false, message: "block hover preview did not show the referenced theorem content" };
  }
  if (!theoremPreview.includes("Third list item with an equation reference")) {
    return { pass: false, message: "block hover preview missed nested list content from the referenced block" };
  }
  const theoremPreviewState = await page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
    if (!(tooltip instanceof HTMLElement)) {
      return null;
    }
    return {
      hasBlockquote: Boolean(tooltip.querySelector("blockquote")),
      scrollHeight: tooltip.scrollHeight,
      clientHeight: tooltip.clientHeight,
    };
  });
  if (!theoremPreviewState?.hasBlockquote) {
    return { pass: false, message: "block hover preview did not render the nested blockquote structure" };
  }

  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
  const equationRef = page.locator("[data-coflat-ref-id='eq:gaussian'], [data-coflat-single-ref-id='eq:gaussian']").first();
  await equationRef.scrollIntoViewIfNeeded();
  await equationRef.hover();
  await page.waitForTimeout(250);
  const equationPreviewState = await page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
    if (!(tooltip instanceof HTMLElement)) {
      return null;
    }
    return {
      headerText: tooltip.querySelector(".cf-hover-preview-header")?.textContent?.trim() ?? "",
      hasDisplayMath: Boolean(tooltip.querySelector(".cf-lexical-display-math")),
      text: tooltip.textContent?.trim() ?? "",
    };
  });
  if (!equationPreviewState?.hasDisplayMath) {
    return { pass: false, message: "equation hover preview did not render the display equation" };
  }
  if (equationPreviewState.headerText) {
    return { pass: false, message: "equation hover preview still shows a redundant title header" };
  }

  const footnote = page.locator(".cf-lexical-footnote-ref").first();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
  await footnote.scrollIntoViewIfNeeded();
  await footnote.hover();
  await page.waitForTimeout(350);
  const footnotePreview = await visiblePreviewText(page);
  if (!footnotePreview.includes("This is the footnote content")) {
    return { pass: false, message: "footnote hover preview did not render the footnote body" };
  }

  const figureRef = page.locator("[data-coflat-ref-id='fig:pdf-local']").first();
  await figureRef.hover();
  await page.waitForFunction(
    () => {
      const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
      return tooltip instanceof HTMLElement && Boolean(tooltip.querySelector("img"));
    },
    { timeout: 5000 },
  ).catch(() => {});
  const figurePreviewState = await page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
    if (!(tooltip instanceof HTMLElement)) {
      return null;
    }
    return {
      hasFigureBlock: Boolean(tooltip.querySelector(".cf-lexical-block--figure")),
      hasImage: Boolean(tooltip.querySelector("img")),
      text: tooltip.textContent?.trim() ?? "",
    };
  });
  if (!figurePreviewState?.hasImage) {
    return { pass: false, message: "figure hover preview did not render local media" };
  }
  if (!figurePreviewState.hasFigureBlock) {
    return { pass: false, message: "figure hover preview did not reuse the normal figure block rendering" };
  }
  if (!figurePreviewState.text.includes("Figure 1")) {
    return { pass: false, message: "figure hover preview lost the figure label" };
  }

  const tableRef = page.locator("[data-coflat-ref-id='tbl:feature-matrix']").first();
  await tableRef.hover();
  await page.waitForTimeout(250);
  const tablePreviewState = await page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
    if (!(tooltip instanceof HTMLElement)) {
      return null;
    }
    return {
      hasTableBlock: Boolean(tooltip.querySelector(".cf-lexical-block--table")),
      hasTable: Boolean(tooltip.querySelector("table")),
      text: tooltip.textContent?.trim() ?? "",
    };
  });
  if (!tablePreviewState?.hasTable) {
    return { pass: false, message: "table hover preview did not render the table structure" };
  }
  if (!tablePreviewState.hasTableBlock) {
    return { pass: false, message: "table hover preview did not reuse the normal table block rendering" };
  }
  if (!tablePreviewState.text.includes("Feature coverage matrix")) {
    return { pass: false, message: "table hover preview lost the table caption" };
  }

  return {
    pass: true,
    message: "citations, footnotes, bibliography, and reference hover previews render on the Lexical surface",
  };
}
