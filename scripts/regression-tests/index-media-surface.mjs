import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "index-media-surface";

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });
  await page.waitForFunction(
    () => document.querySelectorAll(".cf-lexical-block--figure img").length > 0,
    { timeout: 5000 },
  ).catch(() => {});
  const state = await page.evaluate(() => {
    const figureCaption = document.querySelector(".cf-lexical-block--figure .cf-lexical-block-caption");
    const figureImage = document.querySelector(".cf-lexical-block--figure img");
    const tableCaption = document.querySelector(".cf-lexical-block--table .cf-lexical-block-caption");
    const tableElement = document.querySelector(".cf-lexical-block--table table");

    const figureCaptionBox = figureCaption?.getBoundingClientRect() ?? null;
    const figureImageBox = figureImage?.getBoundingClientRect() ?? null;
    const tableCaptionBox = tableCaption?.getBoundingClientRect() ?? null;
    const tableBox = tableElement?.getBoundingClientRect() ?? null;

    return {
      gistIframeCount: document.querySelectorAll(".cf-lexical-block--gist iframe").length,
      includeEditorCount: [...document.querySelectorAll(".cf-lexical-nested-editor--include-path")]
        .filter((element) => getComputedStyle(element).display !== "none").length,
      mathmlPosition: getComputedStyle(document.querySelector(".katex-mathml") ?? document.body).position,
      tableCaptionBelow: Boolean(tableCaptionBox && tableBox && tableCaptionBox.top >= tableBox.bottom - 1),
      tableCaptionText: tableCaption?.textContent?.trim() ?? "",
      tableCount: document.querySelectorAll(".cf-lexical-block--table table").length,
      figureCaptionBelow: Boolean(figureCaptionBox && figureImageBox && figureCaptionBox.top >= figureImageBox.bottom - 1),
      figureCaptionText: figureCaption?.textContent?.trim() ?? "",
      figureImageCount: document.querySelectorAll(".cf-lexical-block--figure img").length,
      youtubeIframeCount: document.querySelectorAll(".cf-lexical-block--youtube iframe").length,
    };
  });

  if (state.mathmlPosition !== "absolute") {
    return { pass: false, message: "KaTeX stylesheet is missing and math is leaking duplicate MathML text" };
  }
  if (state.figureImageCount === 0) {
    return { pass: false, message: "figure block did not render a local media preview" };
  }
  if (!state.figureCaptionBelow || !state.figureCaptionText.includes("Figure 1.")) {
    return { pass: false, message: "figure caption did not render below the media with the numbered label" };
  }
  if (state.tableCount === 0) {
    return { pass: false, message: "table block did not render a real table surface" };
  }
  if (!state.tableCaptionBelow || !state.tableCaptionText.includes("Table 1.")) {
    return { pass: false, message: "table caption did not render below the table with the numbered label" };
  }
  if (state.gistIframeCount === 0 || state.youtubeIframeCount === 0) {
    return { pass: false, message: "embed blocks did not render iframe previews" };
  }
  if (state.includeEditorCount !== 0) {
    return { pass: false, message: "include path editor should stay hidden until explicitly activated" };
  }

  return {
    pass: true,
    message: "math, caption-below blocks, embeds, and include transport surfaces render correctly on index.md",
  };
}
