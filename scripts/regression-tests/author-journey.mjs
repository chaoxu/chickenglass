/**
 * Browser journey: simulate a realistic author session across multiple files.
 *
 * The narrow regression tests already cover individual features. This journey
 * keeps those features in one live session and checks that rich/source
 * transitions, search navigation, autocomplete insertion, and hover previews
 * remain stable together under actual browser usage.
 */

import {
  assertEditorHealth,
  clickSearchDialogResult,
  focusEditorEnd,
  formatRuntimeIssues,
  hideHoverPreview,
  insertEditorText,
  openAppSearch,
  openFixtureDocument,
  pickAutocompleteOption,
  readEditorText,
  readHoverPreviewState,
  showHoverPreview,
  switchToMode,
  waitForHoverPreviewState,
  waitForRenderReady,
  withRestoredFixture,
  withRuntimeIssueCapture,
  waitForAutocomplete,
  resolveFixtureDocument,
} from "../test-helpers.mjs";

export const name = "author-journey";
export const optionalFixtures = true;

const RAW_TOKEN = "raw_token_785_only_in_source";
const TABLE_REF = '.cf-crossref[aria-label="[@tbl:hover]"]';
const FIGURE_REF = '.cf-crossref[aria-label="[@fig:hover]"]';

export async function run(page) {
  const originalReferenceAutocomplete =
    resolveFixtureDocument("cogirth/reference-autocomplete.md").content;

  const { value, issues } = await withRuntimeIssueCapture(page, async () => {
    await openFixtureDocument(page, "cogirth/search-mode-awareness.md", { project: "full-project" });
    await switchToMode(page, "source");
    await assertEditorHealth(page, "source-search start");

    await openAppSearch(page);
    await assertEditorHealth(page, "source-search dialog open", { maxVisibleDialogs: 1 });

    const searchInput = page.locator('[role="dialog"] input');
    await searchInput.fill(RAW_TOKEN);
    await page.waitForFunction(
      (needle) =>
        [...document.querySelectorAll('[role="dialog"] button')].some((button) =>
          (button.textContent ?? "").includes(needle)),
      RAW_TOKEN,
      { timeout: 5000 },
    );

    await clickSearchDialogResult(page, RAW_TOKEN);
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"] input'),
      { timeout: 5000 },
    );
    await waitForRenderReady(page);

    const sourceNavigation = await page.evaluate((needle) => ({
      mode: window.__app.getMode(),
      hasNeedle: window.__cmView.state.doc.toString().includes(needle),
    }), RAW_TOKEN);

    if (sourceNavigation.mode !== "source") {
      throw new Error(`expected source-mode navigation, got ${sourceNavigation.mode}`);
    }
    if (!sourceNavigation.hasNeedle) {
      throw new Error("source-mode search did not navigate to the raw-text target");
    }
    await assertEditorHealth(page, "after source-search navigation");

    await openFixtureDocument(page, "cogirth/reference-autocomplete.md", { project: "full-project" });
    await switchToMode(page, "rich");
    await withRestoredFixture(
      page,
      {
        path: "cogirth/reference-autocomplete.md",
        content: originalReferenceAutocomplete,
      },
      async () => {
        await focusEditorEnd(page);

        await insertEditorText(page, "\n\nJourney cluster [@");
        await waitForAutocomplete(page);
        await pickAutocompleteOption(page, "thm:autocomplete");

        await insertEditorText(page, "; @");
        await waitForAutocomplete(page);
        await pickAutocompleteOption(page, "eq:autocomplete");

        await insertEditorText(page, "] and cite @");
        await waitForAutocomplete(page);
        await pickAutocompleteOption(page, "karger2000");

        const autocompleteDoc = await readEditorText(page);
        if (!autocompleteDoc.includes("Journey cluster [@thm:autocomplete; @eq:autocomplete] and cite @karger2000")) {
          throw new Error("autocomplete journey did not insert the expected bracketed and narrative references");
        }
        await assertEditorHealth(page, "after autocomplete journey");
      },
    );
    await assertEditorHealth(page, "after autocomplete restore");

    await openFixtureDocument(page, "cogirth/hover-preview.md", { project: "full-project" });
    await switchToMode(page, "rich");
    await assertEditorHealth(page, "hover fixture loaded");

    await showHoverPreview(page, TABLE_REF);
    const tableTooltip = await waitForHoverPreviewState(
      page,
      (tooltip) => tooltip.hasTable && tooltip.captionText.includes("Results table"),
    );
    await hideHoverPreview(page, TABLE_REF);

    if (!tableTooltip?.hasTable) {
      throw new Error("table hover preview lost rendered table content during the author journey");
    }

    await showHoverPreview(page, FIGURE_REF);
    const figureTooltip = await waitForHoverPreviewState(
      page,
      (tooltip) =>
        tooltip.captionText.includes("Preview figure")
        && tooltip.imageSrc?.startsWith("data:image/") === true,
    );
    await hideHoverPreview(page, FIGURE_REF);

    if (!figureTooltip?.imageSrc?.startsWith("data:image/")) {
      throw new Error("figure hover preview did not resolve local media during the author journey");
    }

    const finalTooltip = await readHoverPreviewState(page);
    if (finalTooltip !== null) {
      throw new Error("hover preview tooltip stayed visible after the journey finished");
    }

    const finalHealth = await assertEditorHealth(page, "after hover-preview journey");
    return {
      mode: finalHealth.mode,
      docLength: finalHealth.docLength,
      semanticRevision: finalHealth.semantics.revision,
    };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues during author journey: ${formatRuntimeIssues(issues)}`,
    };
  }

  return {
    pass: true,
    message: `source search, autocomplete editing, rich/source transitions, and hover previews stayed healthy (mode=${value.mode}, doc=${value.docLength}, revision=${value.semanticRevision})`,
  };
}
