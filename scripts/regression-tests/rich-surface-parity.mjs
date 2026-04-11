import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "rich-surface-parity";

function same(left, right) {
  return left === right;
}

function getContentCell(page, label) {
  return page
    .locator(`.cf-lexical-table-block tr:has-text("${label}")`)
    .first()
    .locator("td")
    .nth(1);
}

async function readCell(page, label) {
  const cell = getContentCell(page, label);
  if (await cell.count() === 0) {
    return null;
  }

  return cell.evaluate((element) => {
    const normalizeText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
    const selection = window.getSelection();
    const anchorElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const katex = element.querySelector(".katex");
    const citation = element.querySelector(".cf-citation");
    const link = element.querySelector("a.cf-lexical-link");
    const code = element.querySelector(".cf-inline-code");

    return {
      citationCount: element.querySelectorAll(".cf-citation").length,
      citationText: normalizeText(citation?.textContent),
      codeCount: element.querySelectorAll(".cf-inline-code").length,
      codeFontFamily: code ? getComputedStyle(code).fontFamily : null,
      highlightCount: element.querySelectorAll(".cf-highlight").length,
      hasSelection: Boolean(anchorElement && element.contains(anchorElement)),
      katexCount: element.querySelectorAll(".katex").length,
      katexFontSize: katex ? getComputedStyle(katex).fontSize : null,
      linkCount: element.querySelectorAll("a.cf-lexical-link").length,
      linkText: normalizeText(link?.textContent),
      text: normalizeText(element.innerText),
    };
  });
}

async function captureParity(page, label) {
  const before = await readCell(page, label);
  if (!before) {
    return null;
  }
  await getContentCell(page, label).click();
  await page.waitForTimeout(140);
  const after = await readCell(page, label);
  return {
    activated: Boolean(after?.hasSelection),
    after,
    before,
  };
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const state = {
    citation: await captureParity(page, "citation + highlight"),
    code: await captureParity(page, "code + link"),
    math: await captureParity(page, "emphasis + math"),
  };

  if (!state.math || !state.citation || !state.code) {
    return { pass: false, message: "rich table parity fixture did not render the expected rows" };
  }

  if (!state.math.activated || !state.math.after?.hasSelection) {
    return { pass: false, message: "math table cell did not place the caret inside the native table cell" };
  }
  if (!same(state.math.before.katexCount, 1) || !same(state.math.after?.katexCount, 1)) {
    return { pass: false, message: "math table cell lost KaTeX rendering when activated" };
  }
  if (!same(state.math.before.katexFontSize, state.math.after?.katexFontSize ?? null)) {
    return { pass: false, message: "math table cell changed KaTeX typography when activated" };
  }
  if (!same(state.math.before.text, state.math.after?.text ?? "")) {
    return { pass: false, message: "math table cell changed visible content when activated" };
  }

  if (!state.citation.activated || !state.citation.after?.hasSelection) {
    return { pass: false, message: "citation table cell did not place the caret inside the native table cell" };
  }
  if (!same(state.citation.before.citationCount, 1) || !same(state.citation.after?.citationCount, 1)) {
    return { pass: false, message: "citation table cell lost citation rendering when activated" };
  }
  if (!same(state.citation.before.highlightCount, 1) || !same(state.citation.after?.highlightCount, 1)) {
    return { pass: false, message: "citation table cell lost highlight rendering when activated" };
  }
  if (!same(state.citation.before.citationText, state.citation.after?.citationText ?? "")) {
    return { pass: false, message: "citation table cell changed citation text when activated" };
  }
  if (!(state.citation.after?.text ?? "").includes("highlight")) {
    return { pass: false, message: "citation table cell lost the highlight segment when activated" };
  }

  if (!state.code.activated || !state.code.after?.hasSelection) {
    return { pass: false, message: "code/link table cell did not place the caret inside the native table cell" };
  }
  if (!same(state.code.before.codeCount, 1) || !same(state.code.after?.codeCount, 1)) {
    return { pass: false, message: "code/link table cell lost inline code styling when activated" };
  }
  if (!same(state.code.before.linkCount, 1) || !same(state.code.after?.linkCount, 1)) {
    return { pass: false, message: "code/link table cell lost link rendering when activated" };
  }
  if (!same(state.code.before.codeFontFamily, state.code.after?.codeFontFamily ?? null)) {
    return { pass: false, message: "code/link table cell changed code typography when activated" };
  }
  if (!same(state.code.before.linkText, state.code.after?.linkText ?? "")) {
    return { pass: false, message: "code/link table cell changed link text when activated" };
  }

  return {
    pass: true,
    message: "table cells keep the same rich semantics and typography before and after activation",
  };
}
