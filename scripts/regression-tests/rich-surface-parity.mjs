import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "rich-surface-parity";

function same(left, right) {
  return left === right;
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const state = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const normalizeText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";

    const findContentCell = (label) => {
      const row = [...document.querySelectorAll(".cf-lexical-table-block tr")].find((candidate) => {
        const firstCell = candidate.querySelector("th, td");
        return normalizeText(firstCell?.textContent) === label;
      });
      if (!row) {
        return null;
      }
      return row.querySelectorAll("td")[1] ?? null;
    };

    const readCell = (label) => {
      const cell = findContentCell(label);
      if (!(cell instanceof HTMLElement)) {
        return null;
      }
      const katex = cell.querySelector(".katex");
      const citation = cell.querySelector(".cf-citation");
      const link = cell.querySelector("a.cf-lexical-link");
      const code = cell.querySelector(".cf-inline-code");
      return {
        citationCount: cell.querySelectorAll(".cf-citation").length,
        citationText: normalizeText(citation?.textContent),
        codeCount: cell.querySelectorAll(".cf-inline-code").length,
        codeFontFamily: code ? getComputedStyle(code).fontFamily : null,
        editableCount: cell.querySelectorAll("[contenteditable='true']").length,
        highlightCount: cell.querySelectorAll(".cf-highlight").length,
        katexCount: cell.querySelectorAll(".katex").length,
        katexFontSize: katex ? getComputedStyle(katex).fontSize : null,
        linkCount: cell.querySelectorAll("a.cf-lexical-link").length,
        linkText: normalizeText(link?.textContent),
        text: normalizeText(cell.innerText),
      };
    };

    const activateCell = async (label) => {
      const cell = findContentCell(label);
      if (!(cell instanceof HTMLElement)) {
        return false;
      }
      const shell = cell.querySelector(".cf-embedded-field-shell") ?? cell;
      shell.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      shell.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      shell.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      await sleep(140);
      return true;
    };

    const captureParity = async (label) => {
      const before = readCell(label);
      if (!before) {
        return null;
      }
      const activated = await activateCell(label);
      const after = readCell(label);
      return {
        activated,
        after,
        before,
      };
    };

    return {
      citation: await captureParity("citation + highlight"),
      code: await captureParity("code + link"),
      math: await captureParity("emphasis + math"),
    };
  });

  if (!state.math || !state.citation || !state.code) {
    return { pass: false, message: "rich table parity fixture did not render the expected rows" };
  }

  if (!state.math.activated || (state.math.after?.editableCount ?? 0) === 0) {
    return { pass: false, message: "math table cell did not activate the nested Lexical surface" };
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

  if (!state.citation.activated || (state.citation.after?.editableCount ?? 0) === 0) {
    return { pass: false, message: "citation table cell did not activate the nested Lexical surface" };
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

  if (!state.code.activated || (state.code.after?.editableCount ?? 0) === 0) {
    return { pass: false, message: "code/link table cell did not activate the nested Lexical surface" };
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
