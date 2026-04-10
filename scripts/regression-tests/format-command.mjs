import {
  openFixtureDocument,
  readEditorText,
  setSelection,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "format-command";

const FIXTURE = {
  virtualPath: "format-command.md",
  displayPath: "fixture:format-command.md",
  content: "Alpha Beta\n",
};

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });
  const initial = await readEditorText(page);
  const start = initial.indexOf("Beta");
  const end = start + "Beta".length;

  if (start < 0) {
    return { pass: false, message: "fixture text missing expected selection target" };
  }

  await setSelection(page, start, end);
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("cf:format", {
      detail: { type: "bold" },
    }));
  });

  const formatted = await readEditorText(page);
  await switchToMode(page, "source");
  const sourceText = await readEditorText(page);

  if (formatted !== "Alpha **Beta**\n") {
    return { pass: false, message: `unexpected formatted doc: ${JSON.stringify(formatted)}` };
  }

  if (sourceText !== formatted) {
    return { pass: false, message: "source mode does not match formatted lexical doc text" };
  }

  return { pass: true, message: "format events rewrite markdown through the Lexical surface" };
}
