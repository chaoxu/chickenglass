/**
 * Session soak regression: repeat realistic author actions across files/modes.
 *
 * This is intentionally deterministic. It is not a fuzz test; the repo already
 * has an editor-level randomized stress suite. The goal here is a browser-level
 * long-ish session that mixes editing, mode switching, search, file navigation,
 * autocomplete, and hover previews without losing runtime health.
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
  readHoverPreviewState,
  scrollToText,
  showHoverPreview,
  switchToMode,
  waitForHoverPreviewState,
  waitForAutocomplete,
  waitForRenderReady,
  resolveFixtureDocument,
  withRestoredFixture,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "session-soak";
export const optionalFixtures = true;

const CYCLES = 2;
const TABLE_REF = '.cf-crossref[aria-label="[@tbl:hover]"]';
const FIGURE_REF = '.cf-crossref[aria-label="[@fig:hover]"]';

export async function run(page) {
  const originalMain2 = resolveFixtureDocument("cogirth/main2.md").content;
  const originalReferenceAutocomplete =
    resolveFixtureDocument("cogirth/reference-autocomplete.md").content;

  const { value, issues } = await withRuntimeIssueCapture(page, async () => {
    let operations = 0;

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const cycleToken = `cycle_token_${cycle}`;

      await openFixtureDocument(page, "cogirth/main2.md", { project: "full-project" });
      await switchToMode(page, "rich");
      await withRestoredFixture(
        page,
        {
          path: "cogirth/main2.md",
          content: originalMain2,
        },
        async () => {
          await scrollToText(page, "# Main Results");
          await assertEditorHealth(page, `cycle ${cycle}: main2 rich start`);
          operations += 3;

          await focusEditorEnd(page);
          await insertEditorText(
            page,
            `\n\nCycle ${cycle}: see [@thm:main-upper] and [@eq:main-upper].`,
          );
          await assertEditorHealth(page, `cycle ${cycle}: after rich edit`);
          operations += 1;

          await switchToMode(page, "source");
          await focusEditorEnd(page);
          await insertEditorText(
            page,
            `\n\n## Cycle ${cycle} Source Note {#sec:cycle-${cycle}}\n${cycleToken}\n`,
          );
          await assertEditorHealth(page, `cycle ${cycle}: after source edit`);
          operations += 3;

          await openAppSearch(page);
          await assertEditorHealth(page, `cycle ${cycle}: search dialog open`, { maxVisibleDialogs: 1 });
          const searchInput = page.locator('[role="dialog"] input');
          await searchInput.fill(cycleToken);
          await page.waitForFunction(
            (needle) =>
              [...document.querySelectorAll('[role="dialog"] button')].some((button) =>
                (button.textContent ?? "").includes(needle)),
            cycleToken,
            { timeout: 5000 },
          );
          await clickSearchDialogResult(page, cycleToken);
          await page.waitForFunction(
            () => !document.querySelector('[role="dialog"] input'),
            { timeout: 5000 },
          );
          await waitForRenderReady(page);
          await assertEditorHealth(page, `cycle ${cycle}: after source search navigation`);
          operations += 2;
        },
      );
      await assertEditorHealth(page, `cycle ${cycle}: after main2 restore`);
      operations += 1;

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
          await insertEditorText(page, `\n\nCycle ${cycle} cite @`);
          await waitForAutocomplete(page);
          await pickAutocompleteOption(page, "karger2000");
          await assertEditorHealth(page, `cycle ${cycle}: after autocomplete cite`);
          operations += 4;
        },
      );
      await assertEditorHealth(page, `cycle ${cycle}: after autocomplete restore`);
      operations += 1;

      await openFixtureDocument(page, "cogirth/hover-preview.md", { project: "full-project" });
      await switchToMode(page, "rich");
      await showHoverPreview(page, cycle % 2 === 1 ? TABLE_REF : FIGURE_REF);
      const tooltip = await waitForHoverPreviewState(
        page,
        (state) => state.captionText.includes(cycle % 2 === 1 ? "Results table" : "Preview figure"),
      );
      await hideHoverPreview(page, cycle % 2 === 1 ? TABLE_REF : FIGURE_REF);
      if (!tooltip) {
        throw new Error(`cycle ${cycle}: hover preview did not render the expected caption`);
      }
      const hiddenTooltip = await readHoverPreviewState(page);
      if (hiddenTooltip !== null) {
        throw new Error(`cycle ${cycle}: hover preview tooltip stayed visible after hide`);
      }
      await assertEditorHealth(page, `cycle ${cycle}: after hover preview`);
      operations += 3;
    }

    const finalHealth = await assertEditorHealth(page, "session-soak final state");
    return {
      operations,
      mode: finalHealth.mode,
      docLength: finalHealth.docLength,
      semanticRevision: finalHealth.semantics.revision,
    };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues during session soak: ${formatRuntimeIssues(issues)}`,
    };
  }

  return {
    pass: true,
    message: `${value.operations} browser-session operations completed across search, edit, mode, autocomplete, and hover flows (mode=${value.mode}, doc=${value.docLength}, revision=${value.semanticRevision})`,
  };
}
