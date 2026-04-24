/**
 * Regression test: typing @ and [@ offers cross-reference and citation ids.
 */

import {
  insertEditorText,
  openFixtureDocument,
  pickAutocompleteOption,
  readAutocompleteOptions,
  settleEditorLayout,
  switchToMode,
  waitForAutocomplete,
} from "../test-helpers.mjs";

export const name = "reference-autocomplete";

async function focusEditorEnd(page) {
  await page.evaluate(() => {
    const view = window.__cmView;
    view.focus();
    const anchor = view.state.doc.length;
    view.dispatch({ selection: { anchor } });
  });
  await settleEditorLayout(page);
}

async function readDoc(page) {
  return page.evaluate(() => window.__cmView.state.doc.toString());
}

export async function run(page) {
  await openFixtureDocument(page, "cogirth/reference-autocomplete.md", { project: "full-project" });
  await focusEditorEnd(page);

  await insertEditorText(page, "\n\nRich mode [@");
  await waitForAutocomplete(page);

  const richModeOptions = await readAutocompleteOptions(page);
  if (!richModeOptions.some((option) => option.includes("thm:autocomplete"))) {
    return {
      pass: false,
      message: `rich-mode autocomplete for [@ is missing theorem labels: ${JSON.stringify(richModeOptions)}`,
    };
  }
  if (!richModeOptions.some((option) => option.includes("karger2000"))) {
    return {
      pass: false,
      message: `rich-mode autocomplete for [@ is missing citation keys: ${JSON.stringify(richModeOptions)}`,
    };
  }

  await pickAutocompleteOption(page, "thm:autocomplete");

  const afterRichMode = await readDoc(page);
  if (!afterRichMode.includes("Rich mode [@thm:autocomplete")) {
    return {
      pass: false,
      message: "rich-mode autocomplete did not insert the selected bracketed cross-reference id",
    };
  }

  await switchToMode(page, "source");
  await focusEditorEnd(page);

  await insertEditorText(page, "\n\nBracketed [@");
  await waitForAutocomplete(page);

  const bracketedOptions = await readAutocompleteOptions(page);
  if (!bracketedOptions.some((option) => option.includes("thm:autocomplete"))) {
    return {
      pass: false,
      message: `source-mode autocomplete for [@ is missing theorem labels: ${JSON.stringify(bracketedOptions)}`,
    };
  }
  if (!bracketedOptions.some((option) => option.includes("karger2000"))) {
    return {
      pass: false,
      message: `source-mode autocomplete for [@ is missing citation keys: ${JSON.stringify(bracketedOptions)}`,
    };
  }

  await pickAutocompleteOption(page, "thm:autocomplete");

  const afterBracketed = await readDoc(page);
  if (!afterBracketed.includes("Bracketed [@thm:autocomplete")) {
    return {
      pass: false,
      message: "source-mode autocomplete did not insert the selected bracketed cross-reference id",
    };
  }

  await insertEditorText(page, "] and narrative @");
  await waitForAutocomplete(page);

  const narrativeOptions = await readAutocompleteOptions(page);
  if (!narrativeOptions.some((option) => option.includes("karger2000"))) {
    return {
      pass: false,
      message: `autocomplete for @ is missing citation keys: ${JSON.stringify(narrativeOptions)}`,
    };
  }

  await pickAutocompleteOption(page, "karger2000");

  const afterNarrative = await readDoc(page);
  if (!afterNarrative.includes("narrative @karger2000")) {
    return {
      pass: false,
      message: "autocomplete did not insert the selected narrative citation id",
    };
  }

  return {
    pass: true,
    message: "rich/source mode typing for [@ and @ opened completion with semantic labels and citation keys",
  };
}
