import {
  openFixtureDocument,
  readEditorText,
  setRevealPresentation,
  setSelection,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "source-rich-reveal-offsets";
export const groups = ["navigation", "reveal"];

const FIXTURE = {
  virtualPath: "source-rich-reveal-offsets.md",
  displayPath: "fixture:source-rich-reveal-offsets.md",
  content: [
    "# Intro {#sec:intro}",
    "",
    "A [label](https://example.com) ![alt](image.png) [@cormen2009] [^n] $x+1$.",
    "Formatted **bold** marker.",
    "",
    '::: {.theorem #thm:main title="Main"}',
    "Body text.",
    ":::",
    "",
    "[^n]: Footnote body.",
    "",
    "| H | I |",
    "|---|---|",
    "| $x$ | y |",
  ].join("\n"),
};

async function revealAt(page, sourceNeedle, expectedRevealNeedle, offsetInNeedle = 0) {
  const doc = await readEditorText(page);
  const pos = doc.indexOf(sourceNeedle);
  if (pos < 0) {
    throw new Error(`source needle not found: ${sourceNeedle}`);
  }
  await page.evaluate((offset) => {
    window.__editor.setSelection(offset, offset);
  }, pos + offsetInNeedle);
  await page.waitForFunction(
    (needle) => {
      return [...document.querySelectorAll("[data-lexical-text='true']")]
        .some((node) =>
          node instanceof HTMLElement
          && node.style.getPropertyValue("--cf-reveal")
          && (node.textContent ?? "").includes(needle)
        );
    },
    expectedRevealNeedle,
    { timeout: 10000 },
  );
  return page.evaluate((needle) => {
    const selection = window.getSelection();
    for (const node of document.querySelectorAll("[data-lexical-text='true']")) {
      if (
        node instanceof HTMLElement
        && node.style.getPropertyValue("--cf-reveal")
        && (node.textContent ?? "").includes(needle)
      ) {
        const anchorInsideReveal = Boolean(selection?.anchorNode && node.contains(selection.anchorNode));
        return {
          caretOffset: anchorInsideReveal ? selection?.anchorOffset ?? null : null,
          text: node.textContent ?? "",
        };
      }
    }
    return null;
  }, expectedRevealNeedle);
}

export async function run(page) {
  await setRevealPresentation(page, "inline");
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });

  const revealChecks = [
    { sourceNeedle: "sec:intro", expected: " {#sec:intro}" },
    { sourceNeedle: "example.com", expected: "[label](https://example.com)" },
    { sourceNeedle: "image.png", expected: "![alt](image.png)" },
    { sourceNeedle: "cormen2009", expected: "[@cormen2009]" },
    { sourceNeedle: "^n", expected: "[^n]" },
    { sourceNeedle: "x+1", expected: "$x+1$" },
    { sourceNeedle: "**bold**", expected: "**bold**", offset: 1 },
    { sourceNeedle: '::: {.theorem #thm:main title="Main"}', expected: '::: {.theorem #thm:main title="Main"}\nBody text.\n:::' },
    { sourceNeedle: "Body text.", expected: '::: {.theorem #thm:main title="Main"}\nBody text.\n:::', caretNeedle: "Body text." },
    { sourceNeedle: "Footnote body", expected: "[^n]: Footnote body." },
  ];

  for (const check of revealChecks) {
    const revealText = await revealAt(page, check.sourceNeedle, check.expected, check.offset ?? 0);
    if (!revealText?.text.includes(check.expected)) {
      return {
        pass: false,
        message: `source offset ${JSON.stringify(check.sourceNeedle)} did not reveal ${JSON.stringify(check.expected)}; got ${JSON.stringify(revealText?.text ?? null)}`,
      };
    }
    if (
      check.caretNeedle
      && revealText.caretOffset !== revealText.text.indexOf(check.caretNeedle)
    ) {
      return {
        pass: false,
        message: `source offset ${JSON.stringify(check.sourceNeedle)} revealed stale text or wrong caret offset: ${JSON.stringify(revealText)}`,
      };
    }
  }

  const docBeforeTableEdit = await readEditorText(page);
  const tableMathOffset = docBeforeTableEdit.indexOf("| $x$ |") + "| $x".length;
  await setSelection(page, tableMathOffset, tableMathOffset);
  await page.keyboard.type("2");
  await waitForBrowserSettled(page);
  await switchToMode(page, "source");
  const afterTableEdit = await readEditorText(page);
  if (!afterTableEdit.includes("| $x2$ | y |")) {
    return {
      pass: false,
      message: `inline math reveal in a table cell edited the wrong source span: ${JSON.stringify(afterTableEdit)}`,
    };
  }

  return {
    pass: true,
    message: "source offsets reveal the nearest editable source-backed node and table-cell math edits stay in-cell",
  };
}
