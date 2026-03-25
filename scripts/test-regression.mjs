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

/* global window */

import console from "node:console";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectEditor } from "./test-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "regression-tests");

/** Parse CLI arguments. */
function parseArgs() {
  const argv = process.argv.slice(2);
  const getValue = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };

  const port = parseInt(getValue("--port", "9322"), 10);
  const filterArg = getValue("--filter", "");
  const filter = filterArg ? filterArg.split(",").map((s) => s.trim()) : [];

  return { port, filter };
}

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

/** Wait for the debug bridge (__app, __cmView, __cmDebug) to be available. */
async function waitForDebugBridge(page) {
  await page.waitForFunction(
    () => Boolean(window.__app && window.__cmView && window.__cmDebug),
    { timeout: 15000 },
  );
}

/** Ensure the editor is in rich mode and index.md is loaded (baseline state). */
async function resetEditorState(page) {
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 200));
}

async function main() {
  const { port, filter } = parseArgs();

  console.log("Browser Regression Tests");
  console.log("========================\n");

  // Connect to Chrome
  let page;
  try {
    page = await connectEditor(port);
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
    await waitForDebugBridge(page);
  } catch {
    console.error("Timed out waiting for debug bridge (__app, __cmView, __cmDebug).");
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
  try {
    await page.context().browser()?.close();
  } catch {
    // Ignore disconnect errors — the browser may already be closed
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
