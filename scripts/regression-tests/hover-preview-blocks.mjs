/**
 * Regression test: hover previews for table and figure cross-references.
 *
 * Verifies that block hover previews reuse the same rendered block surface as
 * read mode: tables keep their wrapper/caption, and figures can resolve local
 * image media instead of showing only raw markdown.
 */

/* global window */

import {
  hideHoverPreview,
  openFile,
  scrollToText,
  showHoverPreview,
  sleep,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "hover-preview-blocks";

const TABLE_REF = '.cf-crossref[aria-label="[@tbl:hover]"]';
const FIGURE_REF = '.cf-crossref[aria-label="[@fig:hover]"]';
const MISSING_FIGURE_REF = '.cf-crossref[aria-label="[@fig:missing]"]';

async function readTooltipState(page) {
  return page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip");
    if (!(tooltip instanceof HTMLElement) || tooltip.style.display === "none") {
      return null;
    }
    return {
      text: tooltip.textContent ?? "",
      hasTable: Boolean(tooltip.querySelector(".cf-block-table table")),
      hasCaption: Boolean(tooltip.querySelector(".cf-block-caption")),
      captionText: tooltip.querySelector(".cf-block-caption")?.textContent ?? "",
      imageSrc: tooltip.querySelector(".cf-block-figure img")?.getAttribute("src") ?? null,
    };
  });
}

async function waitForTooltipState(page, predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tooltip = await readTooltipState(page);
    if (tooltip && predicate(tooltip)) {
      return tooltip;
    }
    await sleep(200);
  }
  return await readTooltipState(page);
}

export async function run(page) {
  await openFile(page, "cogirth/hover-preview.md");
  await switchToMode(page, "rich");
  await scrollToText(page, "See [@tbl:hover], [@fig:hover], and [@fig:missing].");

  await showHoverPreview(page, TABLE_REF);
  const tableTooltip = await readTooltipState(page);
  await hideHoverPreview(page, TABLE_REF);

  if (!tableTooltip?.hasTable) {
    return { pass: false, message: "Table hover preview is missing rendered table content" };
  }
  if (!tableTooltip.hasCaption || !tableTooltip.captionText.includes("Results table")) {
    return { pass: false, message: "Table hover preview is missing its caption wrapper" };
  }

  await showHoverPreview(page, FIGURE_REF);
  const figureTooltip = await waitForTooltipState(
    page,
    (tooltip) => tooltip.imageSrc?.startsWith("data:image/") === true,
  );
  await hideHoverPreview(page, FIGURE_REF);

  if (!figureTooltip?.hasCaption || !figureTooltip.captionText.includes("Preview figure")) {
    return { pass: false, message: "Figure hover preview is missing its caption wrapper" };
  }
  if (!figureTooltip.imageSrc?.startsWith("data:image/")) {
    return { pass: false, message: "Figure hover preview did not resolve local image media on first hover" };
  }

  await showHoverPreview(page, MISSING_FIGURE_REF);
  const missingTooltip = await waitForTooltipState(
    page,
    (tooltip) => tooltip.text.includes("Preview unavailable: missing-preview.pdf"),
  );
  await hideHoverPreview(page, MISSING_FIGURE_REF);

  if (!missingTooltip?.hasCaption || !missingTooltip.captionText.includes("Missing preview")) {
    return { pass: false, message: "Missing-figure hover preview is missing its caption wrapper" };
  }
  if (missingTooltip.imageSrc !== null) {
    return { pass: false, message: "Missing-figure hover preview left a broken image element in the tooltip" };
  }
  if (!missingTooltip.text.includes("Preview unavailable: missing-preview.pdf")) {
    return { pass: false, message: "Missing-figure hover preview did not surface the fallback text" };
  }

  return {
    pass: true,
    message: "Table and figure hover previews refresh to rendered or fallback block content",
  };
}
