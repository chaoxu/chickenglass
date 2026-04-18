import { openFixtureDocument, switchToMode } from "../test-helpers.mjs";
import { resolveFixtureDocumentWithFallback } from "../test-helpers/fixtures.mjs";

export const name = "include-composition";

const MAIN_CONTENT = [
  "# Include Composition",
  "",
  "::: {.include}",
  "included.md",
  ":::",
  "",
  "# After Include",
].join("\n");

const INCLUDED_CONTENT = [
  "# Included Section",
  "",
  "This content comes from an included file.",
  "",
  "::: {.definition #def:included} Included Definition",
  "Included Definition body.",
  ":::",
].join("\n");

const PUBLIC_INCLUDE_FALLBACK = {
  content: MAIN_CONTENT,
  displayPath: "public include-composition fallback",
  projectFiles: [
    {
      content: MAIN_CONTENT,
      kind: "text",
      path: "public-include/main.md",
    },
    {
      content: INCLUDED_CONTENT,
      kind: "text",
      path: "public-include/included.md",
    },
  ],
  virtualPath: "public-include/main.md",
};

export async function run(page) {
  await openFixtureDocument(
    page,
    resolveFixtureDocumentWithFallback("cogirth/include-labels.md", PUBLIC_INCLUDE_FALLBACK),
    { project: "full-project" },
  );
  await page.waitForTimeout(500);

  const lexicalState = await page.evaluate(() => ({
    doc: window.__editor?.getDoc?.() ?? "",
    headings: [...document.querySelectorAll(".cf-lexical-heading")]
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean),
    includeShells: document.querySelectorAll(".cf-lexical-include-shell").length,
    sourceMapRegions: window.__cfSourceMap?.regions.length ?? 0,
  }));

  if (lexicalState.sourceMapRegions === 0) {
    return { pass: false, message: "include composition did not publish a source map" };
  }

  if (!lexicalState.doc.includes("This content comes from an included file.")) {
    return { pass: false, message: "editor doc did not include expanded include content" };
  }

  if (lexicalState.doc.includes("::: {.include}")) {
    return { pass: false, message: "editor doc still contains raw include fences instead of composed content" };
  }

  if (!lexicalState.headings.includes("Included Section")) {
    return { pass: false, message: "outline/headings did not include the included document heading" };
  }

  if (lexicalState.includeShells !== 0) {
    return { pass: false, message: "rich mode still rendered include blocks as preview shells instead of composed content" };
  }

  await switchToMode(page, "source");

  const sourceState = await page.evaluate(() => ({
    doc: window.__editor?.getDoc?.() ?? "",
    sourceMapRegions: window.__cfSourceMap?.regions.length ?? 0,
  }));

  if (sourceState.sourceMapRegions !== lexicalState.sourceMapRegions) {
    return { pass: false, message: "source map regions changed after switching to source mode" };
  }

  if (!sourceState.doc.includes("Included Definition")) {
    return { pass: false, message: "source mode lost the composed include content" };
  }

  return {
    pass: true,
    message: `composed include view preserved ${lexicalState.sourceMapRegions} source-mapped region(s) across lexical/source modes`,
  };
}
