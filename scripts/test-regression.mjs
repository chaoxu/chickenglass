#!/usr/bin/env node
/**
 * Browser regression test runner.
 *
 * Runs browser regressions in a Playwright-owned browser by default, with an
 * optional CDP mode for debugging against a manually managed app window.
 *
 * Prerequisites:
 *   - managed mode starts the Vite dev server automatically when needed
 *   - cdp mode still needs a browser from `pnpm chrome`
 *
 * Usage:
 *   pnpm test:browser
 *   node scripts/test-regression.mjs [--browser managed|cdp] [--headed] [--filter headings,math]
 *   node scripts/test-regression.mjs --scenario smoke
 */

import console from "node:console";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseChromeArgs } from "./chrome-common.mjs";
import {
  connectEditor,
  createArgParser,
  disconnectBrowser,
  ensureAppServer,
  resetEditorState,
  waitForDebugBridge,
} from "./test-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "regression-tests");
const SMOKE_FILTER = ["mode-switch", "index-open-rich-render", "headings", "math-render"];

function normalizeCliArgs(args) {
  return args.filter((arg) => arg !== "--");
}

function resolveFilter({ filterArg, scenarioArg }) {
  if (filterArg) {
    return filterArg.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (!scenarioArg) {
    return [];
  }

  if (scenarioArg === "smoke") {
    return SMOKE_FILTER;
  }

  throw new Error(
    `Unknown browser regression scenario "${scenarioArg}". Available scenarios: smoke`,
  );
}

/** Dynamically import all test modules from the regression-tests directory. */
async function loadTests(filter) {
  const files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .filter((file) => {
      if (filter.length === 0) return true;
      const basename = file.replace(/\.mjs$/, "");
      return filter.includes(basename);
    })
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
  const args = normalizeCliArgs(process.argv.slice(2));
  const chromeArgs = parseChromeArgs(args, { browser: "managed" });
  const { getFlag, getIntFlag, hasFlag } = createArgParser(args);
  const filterArg = getFlag("--filter", "");
  const scenarioArg = getFlag("--scenario", "");
  const timeout = getIntFlag("--timeout", 15000);
  const filter = resolveFilter({ filterArg, scenarioArg });

  console.log("Browser Regression Tests");
  console.log("========================\n");

  // Connect to the browser harness
  let page;
  let stopAppServer = null;
  try {
    stopAppServer = await ensureAppServer(chromeArgs.url, {
      autoStart: !hasFlag("--no-start-server"),
    });
    page = await connectEditor({
      browser: chromeArgs.browser,
      headless: chromeArgs.headless,
      port: chromeArgs.port,
      timeout,
      url: chromeArgs.url,
    });
  } catch (err) {
    console.error("Failed to open the browser regression harness.");
    console.error("Managed mode starts the app server automatically for localhost URLs.");
    console.error("To start it manually, run:");
    console.error("  pnpm dev");
    console.error("Optional manual browser lane:");
    console.error("  pnpm chrome");
    console.error(`\nError: ${err.message}`);
    if (stopAppServer) {
      await stopAppServer();
    }
    process.exit(1);
  }

  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (page) {
      await disconnectBrowser(page);
      page = null;
    }
    if (stopAppServer) {
      await stopAppServer();
      stopAppServer = null;
    }
  };
  const onSigint = () => {
    cleanup().finally(() => process.exit(130));
  };
  const onSigterm = () => {
    cleanup().finally(() => process.exit(143));
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    // Wait for the app to be ready
    try {
      if (chromeArgs.browser === "cdp") {
        await page.reload({ waitUntil: "load" });
      }
      await waitForDebugBridge(page, { timeout });
    } catch {
      console.error("Timed out waiting for debug bridge (__app, __editor, and product-specific debug globals).");
      console.error("The dev server may not have finished loading.");
      process.exitCode = 1;
      return;
    }

    // Load test modules
    const tests = await loadTests(filter);
    if (tests.length === 0) {
      console.error("No test modules found.");
      if (filter.length > 0) {
        console.error(`Filter: ${filter.join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Running ${tests.length} test(s)...\n`);

    const results = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

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

        if (result.skipped) {
          console.log(`  SKIP  ${test.name} (${elapsed}ms)${suffix}`);
          skipped++;
        } else if (result.pass) {
          console.log(`  PASS  ${test.name} (${elapsed}ms)${suffix}`);
          passed++;
        } else {
          console.log(`  FAIL  ${test.name} (${elapsed}ms)${suffix}`);
          failed++;
        }

        results.push({
          name: test.name,
          pass: result.pass,
          skipped: Boolean(result.skipped),
          message: result.message,
          elapsed,
        });
      } catch (err) {
        const elapsed = Date.now() - startTime;
        if (err.message?.includes("Missing fixture for")) {
          console.log(`  SKIP  ${test.name} (${elapsed}ms) — ${err.message}`);
          results.push({ name: test.name, pass: true, skipped: true, message: err.message, elapsed });
          skipped++;
          continue;
        }
        // Detect Chrome disconnection — abort remaining tests
        if (err.message?.includes("Target closed") || err.message?.includes("Protocol error")) {
          console.log(`  FAIL  ${test.name} (${elapsed}ms) — Chrome disconnected`);
          console.error("\nChrome disconnected mid-test. Aborting remaining tests.");
          results.push({ name: test.name, pass: false, message: "Chrome disconnected", elapsed });
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
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${results.length} total`);

    if (failed > 0) {
      console.log("\nFailed tests:");
      for (const r of results) {
        if (!r.pass) {
          console.log(`  - ${r.name}: ${r.message ?? "no message"}`);
        }
      }
    }

    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
