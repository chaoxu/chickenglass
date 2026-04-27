/**
 * Regression test: bibliography backlink arrows use a compact rich hover
 * preview surface instead of the browser-native title tooltip.
 */

import {
  hideHoverPreview,
  openEditorScenario,
  readHoverPreviewState,
  showHoverPreview,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "bibliography-backlink-preview";

const DOC = [
  "---",
  "bibliography: references.bib",
  "---",
  "",
  "# Citation Preview",
  "",
  "See **Karger** with inline math $x^2$ [@karger2000].",
  "",
].join("\n");

const BIB = [
  "@article{karger2000,",
  "  author = {Karger, David R.},",
  "  title = {Minimum cuts in near-linear time},",
  "  journal = {JACM},",
  "  year = {2000}",
  "}",
  "",
].join("\n");

export async function run(page) {
  await openEditorScenario(page, {
    entry: "bibliography-backlink-preview.md",
    files: {
      "bibliography-backlink-preview.md": DOC,
      "references.bib": BIB,
    },
    mode: "cm6-rich",
    waitFor: { selector: ".cf-bibliography-backlink" },
  });
  await waitForRenderReady(page, {
    selector: ".cf-bibliography-backlink",
    frameCount: 3,
    delayMs: 64,
  });

  await showHoverPreview(page, ".cf-bibliography-backlink");
  const tooltip = await readHoverPreviewState(page);
  await hideHoverPreview(page, ".cf-bibliography-backlink");

  if (!tooltip) {
    return { pass: false, message: "bibliography backlink hover did not show a preview" };
  }
  if (tooltip.hasNativeTitle !== false) {
    return { pass: false, message: "bibliography backlink still exposes a native title tooltip" };
  }
  if (!tooltip.hasBody || !tooltip.hasBold || !tooltip.hasKatex) {
    return {
      pass: false,
      message: `bibliography backlink preview should render rich line context: ${JSON.stringify(tooltip)}`,
    };
  }
  if (
    !tooltip.text.includes("Line 7")
    || tooltip.text.includes("**Karger**")
    || tooltip.text.includes("[@karger2000]")
    || !tooltip.citationText
    || tooltip.citationText === "karger2000"
  ) {
    return {
      pass: false,
      message: `bibliography backlink preview missing rendered citation context: ${JSON.stringify(tooltip)}`,
    };
  }

  return {
    pass: true,
    message: "bibliography backlink arrow shows compact rich citation-context preview",
  };
}
