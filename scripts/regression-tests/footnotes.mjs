import { openAndSettleRegressionDocument } from "../test-helpers.mjs";

export const name = "footnotes";
export const groups = ["index"];

export async function run(page) {
  await openAndSettleRegressionDocument(page, "index.md");

  const state = await page.evaluate(() => ({
    definitionCount: document.querySelectorAll(".cf-lexical-footnote-definition").length,
    refCount: document.querySelectorAll(".cf-lexical-footnote-ref").length,
    tree: window.__cmDebug?.treeString?.() ?? "",
  }));

  if (!state.tree.includes("coflat-footnote-reference")) {
    return { pass: false, message: "debug tree did not report any footnote references" };
  }

  if (state.refCount === 0 || state.definitionCount === 0) {
    return { pass: false, message: "rich mode did not render footnote references and definitions" };
  }

  return {
    pass: true,
    message: `${state.refCount} footnote refs and ${state.definitionCount} footnote definitions rendered`,
  };
}
