#!/usr/bin/env node
/**
 * Browser regression test runner.
 *
 * Runs browser regressions in a Playwright-owned browser by default, with an
 * optional CDP mode for debugging against a manually managed app window.
 *
 * Prerequisites:
 *   1. pnpm dev       — start the Vite dev server
 *   2. Optional: pnpm chrome -- --browser cdp
 *
 * Usage:
 *   pnpm test:browser
 *   pnpm test:browser:list
 *   node scripts/test-regression.mjs [--browser managed|cdp] [--headed] [--group reveal] [--filter headings,math]
 */

import console from "node:console";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  expandBrowserTestSelection,
  formatBrowserTestList,
} from "./browser-test-groups.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";
import {
  connectEditor,
  createArgParser,
  disconnectBrowser,
  formatRuntimeIssues,
  resetEditorState,
  waitForDebugBridge,
  withRuntimeIssueCapture,
} from "./test-helpers.mjs";
import { isMissingFixtureError } from "./test-helpers/fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "regression-tests");
const EXTERNAL_EMBED_ROUTE_PATTERNS = [
  /^https:\/\/www\.youtube\.com\/embed\//,
];

/** Dynamically import all test modules from the regression-tests directory. */
export async function loadTests() {
  const files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();

  const tests = [];
  for (const file of files) {
    const mod = await import(join(TESTS_DIR, file));
    if (typeof mod.name !== "string" || typeof mod.run !== "function") {
      console.warn(`  Skipping ${file}: missing name or run export`);
      continue;
    }
    tests.push({
      file,
      name: mod.name,
      run: mod.run,
      runtimeIssueOptions: mod.runtimeIssueOptions ?? {},
    });
  }

  return tests;
}

async function installExternalEmbedStubs(page) {
  for (const pattern of EXTERNAL_EMBED_ROUTE_PATTERNS) {
    await page.route(pattern, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body data-coflat-embed-stub=\"youtube\"></body></html>",
      })
    ).catch(() => {});
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const chromeArgs = parseChromeArgs(args, { browser: "managed" });
  const { getFlag, hasFlag } = createArgParser(args);
  const filterArg = getFlag("--filter", "");
  const groupArg = getFlag("--group", "");

  console.log("Browser Regression Tests");
  console.log("========================\n");

  const allTests = await loadTests();
  if (hasFlag("--list")) {
    console.log(formatBrowserTestList(allTests));
    return;
  }

  const selection = expandBrowserTestSelection({
    availableTestNames: allTests.map((test) => test.name),
    filterArg,
    groupArg,
  });
  if (selection.unknownGroups.length > 0 || selection.unknownTests.length > 0) {
    if (selection.unknownGroups.length > 0) {
      console.error(`Unknown group(s): ${selection.unknownGroups.join(", ")}`);
    }
    if (selection.unknownTests.length > 0) {
      console.error(`Unknown test(s): ${selection.unknownTests.join(", ")}`);
    }
    console.error("");
    console.error(formatBrowserTestList(allTests));
    process.exit(1);
  }
  const selectedNames = new Set(selection.selected);
  const tests = allTests.filter((test) => selectedNames.has(test.name));

  // Connect to the browser harness
  let page;
  try {
    page = await connectEditor({
      browser: chromeArgs.browser,
      headless: chromeArgs.headless,
      port: chromeArgs.port,
      url: chromeArgs.url,
    });
  } catch (err) {
    console.error("Failed to open the browser regression harness.");
    console.error("Make sure the app server is running:");
    console.error("  1. pnpm dev");
    console.error("Optional manual browser lane:");
    console.error("  2. pnpm chrome");
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }

  // Wait for the app to be ready
  try {
    if (chromeArgs.browser === "cdp") {
      await page.reload({ waitUntil: "load" });
    }
    await waitForDebugBridge(page);
    await installExternalEmbedStubs(page);
  } catch {
    console.error("Timed out waiting for debug bridge (__app, __cfDebug).");
    console.error("The dev server may not have finished loading.");
    process.exit(1);
  }

  if (tests.length === 0) {
    console.error("No test modules found.");
    if (filterArg || groupArg) {
      console.error(`Filter: ${filterArg || "<none>"}`);
      console.error(`Group: ${groupArg || "<none>"}`);
    }
    process.exit(1);
  }

  console.log(`Running ${tests.length} test(s)...\n`);

  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const test of tests) {
    const startTime = Date.now();
    try {
      const { value: result, issues } = await withRuntimeIssueCapture(
        page,
        async () => {
          await resetEditorState(page);
          return test.run(page);
        },
        test.runtimeIssueOptions,
      );
      const elapsed = Date.now() - startTime;
      const runtimeMessage = issues.length > 0
        ? `runtime issues: ${formatRuntimeIssues(issues)}`
        : "";
      const message = [runtimeMessage, result.message].filter(Boolean).join("; ");
      const pass = result.pass && issues.length === 0;
      const suffix = message ? ` — ${message}` : "";

      if (pass) {
        console.log(`  PASS  ${test.name} (${elapsed}ms)${suffix}`);
        passed++;
      } else {
        console.log(`  FAIL  ${test.name} (${elapsed}ms)${suffix}`);
        failed++;
      }

      results.push({ name: test.name, pass, message, elapsed });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const runtimeIssues = Array.isArray(err.runtimeIssues) ? err.runtimeIssues : [];
      const runtimeSuffix = runtimeIssues.length > 0
        ? `; runtime issues: ${formatRuntimeIssues(runtimeIssues)}`
        : "";
      if (isMissingFixtureError(err)) {
        const message = `missing required fixture: ${err.message}`;
        console.log(`  FAIL  ${test.name} (${elapsed}ms) — ${message}`);
        results.push({ name: test.name, pass: false, failureKind: "missing-fixture", message, elapsed });
        failed++;
        continue;
      }
      // Detect Chrome disconnection — abort remaining tests
      if (err.message?.includes("Target closed") || err.message?.includes("Protocol error")) {
        console.log(`  FAIL  ${test.name} (${elapsed}ms) — Chrome disconnected`);
        console.error("\nChrome disconnected mid-test. Aborting remaining tests.");
        failed++;
        break;
      }
      console.log(`  FAIL  ${test.name} (${elapsed}ms) — Error: ${err.message}${runtimeSuffix}`);
      results.push({ name: test.name, pass: false, message: `Error: ${err.message}${runtimeSuffix}`, elapsed });
      failed++;
    }
  }

  // Summary
  console.log("\n========================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${results.length} total`);
  const missingFixtureFailures = results.filter((result) => result.failureKind === "missing-fixture");
  if (missingFixtureFailures.length > 0) {
    console.log(`Missing fixture failures: ${missingFixtureFailures.length}`);
  }

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results) {
      if (!r.pass) {
        console.log(`  - ${r.name}: ${r.message ?? "no message"}`);
      }
    }
  }

  // Disconnect
  await disconnectBrowser(page);

  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });
}
