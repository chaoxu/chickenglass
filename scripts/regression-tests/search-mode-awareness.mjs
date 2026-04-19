import { closeAppSearch, openAppSearch, openFixtureDocument } from "../test-helpers.mjs";
import { resolveFixtureDocumentWithFallback } from "../test-helpers/fixtures.mjs";

export const name = "search-mode-awareness";
export const runtimeIssueOptions = {
  // Tracked as #316. Keep this behavior test focused on search mode routing
  // until the lifecycle warning is fixed at the navigation/dialog boundary.
  ignoreConsole: [
    "Cannot update a component",
    "flushSync was called from inside a lifecycle method",
  ],
};

const RAW_TOKEN = "raw_token_785_only_in_source";
const SEMANTIC_LABEL = "#thm-search-785";
const PUBLIC_SEARCH_FALLBACK = {
  content: [
    "# Search Mode Fixture",
    "",
    "::: {.theorem #thm-search-785} Mode-aware theorem",
    "Semantic theorem body.",
    ":::",
    "",
    `<!-- ${RAW_TOKEN} -->`,
  ].join("\n"),
  displayPath: "public search-mode fallback",
  virtualPath: "public-search/search-mode-awareness.md",
};

function dialogSnapshot() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }

  return {
    hasTypeFilter: Boolean(
      dialog.querySelector('[aria-label="Filter search results by block type"]'),
    ),
    placeholder: dialog.querySelector("input")?.getAttribute("placeholder") ?? null,
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
  await openFixtureDocument(
    page,
    resolveFixtureDocumentWithFallback("cogirth/search-mode-awareness.md", PUBLIC_SEARCH_FALLBACK),
    { project: "full-project" },
  );
  await setMode(page, "lexical");

  await openAppSearch(page);
  const semanticUi = await page.evaluate(dialogSnapshot);
  if (!semanticUi) {
    return { pass: false, message: "search dialog did not open in lexical mode" };
  }
  if (semanticUi.placeholder !== "Search blocks, labels, math…") {
    return { pass: false, message: `unexpected lexical-mode search placeholder: ${JSON.stringify(semanticUi.placeholder)}` };
  }
  if (!semanticUi.hasTypeFilter) {
    return { pass: false, message: "lexical-mode search is missing the semantic type filter" };
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
    return { pass: false, message: `unexpected source-mode search placeholder: ${JSON.stringify(sourceUi.placeholder)}` };
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
      (candidate.textContent ?? "").includes(needle));
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
  await page.waitForTimeout(300);

  const navigationState = await page.evaluate((needle) => ({
    doc: window.__editor?.getDoc?.() ?? "",
    mode: window.__app?.getMode?.() ?? null,
  }), RAW_TOKEN);

  if (navigationState.mode !== "source") {
    return { pass: false, message: `search result opened in ${navigationState.mode} mode instead of source mode` };
  }

  if (!navigationState.doc.includes(RAW_TOKEN)) {
    return { pass: false, message: "source-mode search did not open the matching document" };
  }

  return {
    pass: true,
    message: "search switched between semantic/source behavior and preserved source mode across navigation",
  };
}
