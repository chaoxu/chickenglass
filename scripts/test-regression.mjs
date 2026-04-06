#!/usr/bin/env node
/**
 * Browser regression test runner.
 *
 * Connects to a running Chrome instance via CDP, runs all regression test
 * modules sequentially, and reports pass/fail results.
 *
 * Prerequisites:
 *   1. npm run dev    — start the Vite dev server
 *   2. npm run chrome — launch Chrome for Testing with CDP on port 9322
 *
 * Usage:
 *   npm run test:browser
 *   node scripts/test-regression.mjs [--port 9322] [--filter headings,math]
 */

import console from "node:console";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectEditor, createArgParser, waitForDebugBridge, resetEditorState, disconnectBrowser } from "./test-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "regression-tests");

/** Dynamically import all test modules from the regression-tests directory. */
async function loadTests(filter) {
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
    if (filter.length > 0 && !filter.includes(mod.name)) {
      continue;
    }
    tests.push({ file, name: mod.name, run: mod.run });
  }

  return tests;
}

async function main() {
  const { getFlag, getIntFlag } = createArgParser();
  const port = getIntFlag("--port", 9322);
  const url = getFlag("--url");
  const filterArg = getFlag("--filter", "");
  const filter = filterArg ? filterArg.split(",").map((s) => s.trim()) : [];

  console.log("Browser Regression Tests");
  console.log("========================\n");

  // Connect to Chrome
  let page;
  try {
    page = await connectEditor(port, { url });
  } catch (err) {
    console.error("Failed to connect to Chrome via CDP.");
    console.error("Make sure both are running:");
    console.error("  1. npm run dev");
    console.error("  2. npm run chrome");
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }

  // Wait for the app to be ready
  try {
    await page.reload({ waitUntil: "load" });
    await waitForDebugBridge(page);
  } catch {
    console.error("Timed out waiting for debug bridge (__app, __cmView, __cmDebug, __cfDebug).");
    console.error("The dev server may not have finished loading.");
    process.exit(1);
  }

  // Load test modules
  const tests = await loadTests(filter);
  if (tests.length === 0) {
    console.error("No test modules found.");
    if (filter.length > 0) {
      console.error(`Filter: ${filter.join(", ")}`);
    }
    process.exit(1);
  }

  console.log(`Running ${tests.length} test(s)...\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    // Reset state before each test
    try {
      await resetEditorState(page);
    } catch (err) {
      console.log(`  FAIL  ${test.name} (reset failed: ${err.message})`);
      results.push({ name: test.name, pass: false, message: `Reset failed: ${err.message}` });
      failed++;
      continue;
    }

    // Run the test
    const startTime = Date.now();
    try {
      const result = await test.run(page);
      const elapsed = Date.now() - startTime;
      const suffix = result.message ? ` — ${result.message}` : "";

      if (result.pass) {
        console.log(`  PASS  ${test.name} (${elapsed}ms)${suffix}`);
        passed++;
      } else {
        console.log(`  FAIL  ${test.name} (${elapsed}ms)${suffix}`);
        failed++;
      }

      results.push({ name: test.name, pass: result.pass, message: result.message, elapsed });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      // Detect Chrome disconnection — abort remaining tests
      if (err.message?.includes("Target closed") || err.message?.includes("Protocol error")) {
        console.log(`  FAIL  ${test.name} (${elapsed}ms) — Chrome disconnected`);
        console.error("\nChrome disconnected mid-test. Aborting remaining tests.");
        failed++;
        break;
      }
      console.log(`  FAIL  ${test.name} (${elapsed}ms) — Error: ${err.message}`);
      results.push({ name: test.name, pass: false, message: `Error: ${err.message}`, elapsed });
      failed++;
    }
  }

  // Summary
  console.log("\n========================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);

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

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
