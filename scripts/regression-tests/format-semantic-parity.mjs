import {
  readEditorText,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "format-semantic-parity";
export const groups = ["core", "index", "surfaces"];

const FORMAT_DOC = [
  "---",
  "numbering: global",
  "blocks:",
  "  claim:",
  "    title: Claim",
  "    counter: theorem",
  "---",
  "",
  "# Format Section {#sec:format}",
  "",
  "Intro cites [@thm:format], [@claim:format], [@eq:format], [@tbl:format], and [@sec:format].",
  "",
  "$$",
  "x + y",
  "$$ {#eq:format}",
  "",
  '::: {#thm:format .theorem title="Attribute Title"} Trailing **Title**',
  "Statement with $x$ and a footnote[^fmt].",
  ":::",
  "",
  "::: {.claim #claim:format} Custom Claim",
  "Claim body.",
  ":::",
  "",
  "::: {.table #tbl:format} Running Times",
  "| Term | Value |",
  "|------|-------|",
  "| Math | $x$ and [@thm:format] |",
  ":::",
  "",
  "::: {.blockquote #quote:format}",
  "Quoted $y$ and [@sec:format].",
  ":::",
  "",
  "[^fmt]: Footnote with $z$.",
].join("\n");

async function openFormatDocument(page) {
  await page.evaluate(async (doc) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore cleanup failures from a prior test; openFileWithContent will
        // replace the active document below.
      }
    }
    await app.openFileWithContent("format-semantic-parity.md", doc);
    app.setMode("lexical");
  }, FORMAT_DOC);
  await page.waitForFunction(
    (expected) => window.__editor?.getDoc?.() === expected && window.__app?.getMode?.() === "lexical",
    FORMAT_DOC,
    { timeout: 10000 },
  );
  await waitForBrowserSettled(page);
}

export async function run(page) {
  await openFormatDocument(page);

  const richState = await page.evaluate(() => {
    const normalize = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
    const references = [...document.querySelectorAll("[data-coflat-ref-id], [data-coflat-single-ref-id]")]
      .map((element) => ({
        id: element.getAttribute("data-coflat-ref-id")
          ?? element.getAttribute("data-coflat-single-ref-id")
          ?? "",
        text: normalize(element.textContent),
      }));
    const referenceText = Object.fromEntries(references.map((reference) => [reference.id, reference.text]));
    const theorem = document.querySelector(".cf-lexical-block--theorem");
    const theoremTitle = theorem?.querySelector(".cf-lexical-block-title");
    const theoremLabel = theorem?.querySelector(".cf-lexical-block-label");
    const tableBlock = document.querySelector(".cf-lexical-block--table");
    const tableTitle = tableBlock?.querySelector(".cf-lexical-block-caption-text");
    const tableLabel = tableBlock?.querySelector(".cf-lexical-block-caption-label");
    const claim = document.querySelector(".cf-lexical-block--claim");
    const claimLabel = claim?.querySelector(".cf-lexical-block-label");
    const claimTitle = claim?.querySelector(".cf-lexical-block-title");
    const blockquote = document.querySelector(".cf-lexical-blockquote-shell");
    const blockquoteHeader = blockquote?.querySelector(".cf-lexical-block-header");
    const footnote = document.querySelector(".cf-lexical-footnote-definition");

    return {
      blockquoteHeaderText: normalize(blockquoteHeader?.textContent),
      blockquoteHasKatex: Boolean(blockquote?.querySelector(".katex")),
      claimLabelText: normalize(claimLabel?.textContent),
      claimTitleText: normalize(claimTitle?.textContent),
      displayMathHasKatex: Boolean(document.querySelector(".cf-lexical-display-math .katex")),
      footnoteHasKatex: Boolean(footnote?.querySelector(".katex")),
      footnoteRefCount: document.querySelectorAll(".cf-lexical-footnote-ref").length,
      headingNumber: document.querySelector(".cf-lexical-heading")?.getAttribute("data-coflat-heading-number"),
      referenceText,
      tableLabelText: normalize(tableLabel?.textContent),
      tableHasKatex: Boolean(tableBlock?.querySelector(".katex")),
      tableTitleText: normalize(tableTitle?.textContent),
      theoremLabelText: normalize(theoremLabel?.textContent),
      theoremTitleHasBold: Boolean(theoremTitle?.querySelector("strong, .cf-bold")),
      theoremTitleText: normalize(theoremTitle?.textContent),
    };
  });

  if (
    richState.headingNumber !== "1"
    || !richState.displayMathHasKatex
    || richState.theoremLabelText !== "Theorem 1"
    || richState.theoremTitleText !== "Trailing Title"
    || !richState.theoremTitleHasBold
    || richState.claimLabelText !== "Claim 2"
    || richState.claimTitleText !== "Custom Claim"
    || richState.tableLabelText !== "Table 3"
    || richState.tableTitleText !== "Running Times"
    || !richState.tableHasKatex
    || richState.blockquoteHeaderText !== ""
    || !richState.blockquoteHasKatex
    || richState.footnoteRefCount !== 1
    || !richState.footnoteHasKatex
    || richState.referenceText["thm:format"] !== "Theorem 1"
    || richState.referenceText["claim:format"] !== "Claim 2"
    || richState.referenceText["eq:format"] !== "(1)"
    || richState.referenceText["tbl:format"] !== "Table 3"
    || richState.referenceText["sec:format"] !== "Section 1"
  ) {
    return {
      pass: false,
      message: `FORMAT syntax did not render with expected semantic labels: ${JSON.stringify(richState)}`,
    };
  }

  await switchToMode(page, "source");
  const sourceDoc = await readEditorText(page);
  await switchToMode(page, "lexical");
  const restoredDoc = await readEditorText(page);

  if (sourceDoc !== FORMAT_DOC || restoredDoc !== FORMAT_DOC) {
    return {
      pass: false,
      message: "FORMAT semantic fixture did not preserve canonical markdown across source/rich mode switches",
    };
  }

  return {
    pass: true,
    message: "FORMAT syntax keeps render/index/source parity in the browser editor",
  };
}
