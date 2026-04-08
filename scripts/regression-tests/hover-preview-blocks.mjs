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
  openFixtureDocument,
  readHoverPreviewState,
  scrollToText,
  showHoverPreview,
  switchToMode,
  waitForHoverPreviewState,
} from "../test-helpers.mjs";

export const name = "hover-preview-blocks";

const TABLE_REF = '.cf-crossref[aria-label="[@tbl:hover]"]';
const FIGURE_REF = '.cf-crossref[aria-label="[@fig:hover]"]';
const MISSING_FIGURE_REF = '.cf-crossref[aria-label="[@fig:missing]"]';
export async function run(page) {
  await openFixtureDocument(page, "cogirth/hover-preview.md", { project: "full-project" });
  await switchToMode(page, "rich");
  await scrollToText(page, "See [@tbl:hover], [@tbl:wide], [@thm:hover-code], [@fig:hover], and [@fig:missing].");

  await showHoverPreview(page, TABLE_REF);
  const tableTooltip = await readHoverPreviewState(page);
  await hideHoverPreview(page, TABLE_REF);

  if (!tableTooltip?.hasTable) {
    return { pass: false, message: "Table hover preview is missing rendered table content" };
  }
  if (!tableTooltip.hasCaption || !tableTooltip.captionText.includes("Results table")) {
    return { pass: false, message: "Table hover preview is missing its caption wrapper" };
  }

  await showHoverPreview(page, FIGURE_REF);
  const figureTooltip = await waitForHoverPreviewState(
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
  const missingTooltip = await waitForHoverPreviewState(
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
