import { openFixtureDocument, readEditorText } from "../test-helpers.mjs";

export const name = "nested-blank-click-selection";

const DOC = `::: {.theorem} Test
Alpha

Omega
:::
`;

export async function run(page) {
  await openFixtureDocument(page, {
    content: DOC,
    displayPath: "fixture:nested-blank-click.md",
    virtualPath: `scratch-blank-click-${Date.now()}.md`,
  }, { mode: "lexical" });
  const openedText = await readEditorText(page);
  if (!openedText.includes("Alpha") || !openedText.includes("Omega")) {
    return { pass: false, message: `nested blank-click fixture did not open: ${JSON.stringify(openedText)}` };
  }
  return {
    pass: true,
    message: "nested blank-click fixture opens with the expected theorem body content",
  };
}
