import { openAndSettleRegressionDocument } from "../test-helpers.mjs";

export const name = "headings";
export const groups = ["index"];

export async function run(page) {
  await openAndSettleRegressionDocument(page, "index.md");

  const state = await page.evaluate(() => ({
    headingCount: document.querySelectorAll(".cf-lexical-heading").length,
    sectionNumbers: [...document.querySelectorAll("[data-section-number]")]
      .map((el) => el.getAttribute("data-section-number"))
      .filter(Boolean),
    tree: window.__cmDebug?.treeString?.() ?? "",
  }));

  if (!state.tree.includes("(heading)")) {
    return { pass: false, message: "debug tree did not report any headings" };
  }

  if (state.headingCount === 0) {
    return { pass: false, message: "rich mode did not render any heading surfaces" };
  }

  return {
    pass: true,
    message: `${state.headingCount} headings rendered${state.sectionNumbers.length > 0 ? ` (${state.sectionNumbers.join(", ")})` : ""}`,
  };
}
