import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "cross-references";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    citationCount: document.querySelectorAll(".cf-citation").length,
    crossrefCount: document.querySelectorAll(".cf-crossref").length,
  }));

  if (state.crossrefCount === 0) {
    return { pass: false, message: "rich mode did not render any cross-reference surfaces" };
  }

  if (state.citationCount === 0) {
    return { pass: false, message: "rich mode did not render any citation surfaces" };
  }

  return {
    pass: true,
    message: `${state.crossrefCount} crossrefs and ${state.citationCount} citations rendered`,
  };
}
