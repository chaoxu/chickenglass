/**
 * Regression test: app search follows editor mode and preserves it on navigation.
 *
 * Rich mode should search semantic index entries with a type filter, while
 * source mode should search raw file text and keep the destination file in
 * source mode after a cross-file result is opened.
 */

import { closeAppSearch, openAppSearch, openFixtureDocument } from "../test-helpers.mjs";

export const name = "search-mode-awareness";

const RAW_TOKEN = "raw_token_785_only_in_source";
const SEMANTIC_LABEL = "#thm-search-785";

function dialogSnapshot() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }

  return {
    placeholder: dialog.querySelector("input")?.getAttribute("placeholder") ?? null,
    hasTypeFilter: Boolean(
      dialog.querySelector('[aria-label="Filter search results by block type"]'),
    ),
    text: dialog.textContent ?? "",
    buttonTexts: [...dialog.querySelectorAll("button")]
      .map((button) => button.textContent?.trim() ?? "")
      .filter(Boolean),
  };
}

async function setMode(page, mode) {
  await page.evaluate((nextMode) => {
    window.__app.setMode(nextMode);
  }, mode);
  await page.waitForFunction(
    (expectedMode) => window.__app.getMode() === expectedMode,
    mode,
    { timeout: 5000 },
  );
  await page.waitForTimeout(200);
}

export async function run(page) {
  await openFixtureDocument(page, "cogirth/search-mode-awareness.md", { project: "full-project" });
  await setMode(page, "rich");

  await openAppSearch(page);

  const semanticUi = await page.evaluate(dialogSnapshot);
  if (!semanticUi) {
    return { pass: false, message: "search dialog did not open in rich mode" };
  }
  if (semanticUi.placeholder !== "Search blocks, labels, math…") {
    return {
      pass: false,
      message: `unexpected rich-mode search placeholder: ${JSON.stringify(semanticUi.placeholder)}`,
    };
  }
  if (!semanticUi.hasTypeFilter) {
    return { pass: false, message: "rich-mode search is missing the semantic type filter" };
  }

  const input = page.locator('[role="dialog"] input');
  await input.fill(RAW_TOKEN);
  await page.waitForFunction(
    () => (document.querySelector('[role="dialog"]')?.textContent ?? "").includes("No results found"),
    { timeout: 5000 },
  );

  await input.fill(SEMANTIC_LABEL);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="dialog"] button')].some((button) =>
        (button.textContent ?? "").includes("Mode-aware theorem"),
      ),
    { timeout: 5000 },
  );

  await closeAppSearch(page);
  await setMode(page, "source");
  await openAppSearch(page);

  const sourceUi = await page.evaluate(dialogSnapshot);
  if (!sourceUi) {
    return { pass: false, message: "search dialog did not open in source mode" };
  }
  if (sourceUi.placeholder !== "Search source text…") {
    return {
      pass: false,
      message: `unexpected source-mode search placeholder: ${JSON.stringify(sourceUi.placeholder)}`,
    };
  }
  if (sourceUi.hasTypeFilter) {
    return { pass: false, message: "source-mode search still shows the semantic type filter" };
  }

  await input.fill(RAW_TOKEN);
  await page.waitForFunction(
    (needle) =>
      [...document.querySelectorAll('[role="dialog"] button')].some((button) =>
        (button.textContent ?? "").includes(needle),
      ),
    RAW_TOKEN,
    { timeout: 5000 },
  );

  const clicked = await page.evaluate((needle) => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((candidate) =>
      (candidate.textContent ?? "").includes(needle),
    );
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }
    button.click();
    return true;
  }, RAW_TOKEN);

  if (!clicked) {
    return { pass: false, message: "failed to click the source-mode search result" };
  }

  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"] input'),
    { timeout: 5000 },
  );
  await page.waitForTimeout(400);

  const navigationState = await page.evaluate((needle) => ({
    mode: window.__app.getMode(),
    hasNeedle: window.__cmView.state.doc.toString().includes(needle),
  }), RAW_TOKEN);

  if (navigationState.mode !== "source") {
    return {
      pass: false,
      message: `search result opened in ${navigationState.mode} mode instead of source mode`,
    };
  }
  if (!navigationState.hasNeedle) {
    return {
      pass: false,
      message: "search result did not open the target source document",
    };
  }

  return {
    pass: true,
    message: "app search switched between semantic/source behavior and preserved source mode across file navigation",
  };
}
