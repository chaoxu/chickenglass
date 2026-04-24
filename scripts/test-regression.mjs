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
 *   node scripts/test-regression.mjs --scenario lexical
 *   node scripts/test-regression.mjs --allow-missing-fixtures
 */

import console from "node:console";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import { createArgParser, normalizeCliArgs } from "./devx-cli.mjs";
import { runRegressionTestWithChecks } from "./regression-runner-checks.mjs";
import { resetEditorState } from "./editor-test-helpers.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";
import { isMissingFixtureError } from "./fixture-test-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "regression-tests");
const SMOKE_FILTER = ["mode-switch", "index-open-rich-render", "headings", "math-render"];
const LEXICAL_FILTER = ["lexical-smoke"];
const DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;
const SCENARIO_FILTERS = new Map([
  ["smoke", SMOKE_FILTER],
  ["lexical", LEXICAL_FILTER],
]);

function resolveFilter({ filterArg, scenarioArg }) {
  if (filterArg) {
    return filterArg.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (!scenarioArg) {
    return [];
  }

  const scenarioFilter = SCENARIO_FILTERS.get(scenarioArg);
  if (scenarioFilter) {
    return scenarioFilter;
  }

  const scenarios = [...SCENARIO_FILTERS.keys()].join(", ");
  throw new Error(
    `Unknown browser regression scenario "${scenarioArg}". Available scenarios: ${scenarios}`,
  );
}

/** Dynamically import all test modules from the regression-tests directory. */
async function loadTests(filter) {
  const allFiles = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  if (filter.length > 0) {
    const available = allFiles.map((file) => file.replace(/\.mjs$/, ""));
    const unknown = filter.filter((name) => !available.includes(name));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown browser regression filter(s): ${unknown.join(", ")}. ` +
          `Available tests: ${available.join(", ")}`,
      );
    }
  }

  const files = allFiles
    .filter((file) => {
      if (filter.length === 0) return true;
      const basename = file.replace(/\.mjs$/, "");
      return filter.includes(basename);
    });

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
    tests.push({
      file,
      name: mod.name,
      run: mod.run,
      editorHealth: mod.editorHealth,
      optionalFixtures: mod.optionalFixtures,
      runtimeIssues: mod.runtimeIssues,
    });
  }

  return tests;
}

export function shouldSkipMissingFixture(error, test, { allowMissingFixtures = false } = {}) {
  if (!isMissingFixtureError(error)) {
    return false;
  }
  return allowMissingFixtures || test.optionalFixtures === true;
}

async function collectFailureArtifacts(session, label, error) {
  if (!session?.artifactRecorder) return null;
  return session.artifactRecorder.collect({
    error,
    label,
    root: session.artifactsRoot,
  }).then((artifacts) => {
    console.error(`  Artifacts: ${artifacts.outDir}`);
    return artifacts.outDir;
  }).catch((artifactError) => {
    console.error(
      `  Artifact collection failed: ${artifactError instanceof Error ? artifactError.message : String(artifactError)}`,
    );
    return null;
  });
}

async function main() {
  const args = normalizeCliArgs(process.argv.slice(2));
  const { getFlag, getIntFlag, hasFlag } = createArgParser(args);
  const filterArg = getFlag("--filter", "");
  const scenarioArg = getFlag("--scenario", "");
  const timeout = getIntFlag("--timeout", DEFAULT_DEBUG_BRIDGE_TIMEOUT_MS);
  const allowMissingFixtures = hasFlag("--allow-missing-fixtures");
  const filter = resolveFilter({ filterArg, scenarioArg });

  console.log("Browser Regression Tests");
  console.log("========================\n");

  let tests;
  try {
    tests = await loadTests(filter);
    if (tests.length === 0) {
      console.error("No test modules found.");
      if (filter.length > 0) {
        console.error(`Filter: ${filter.join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // Connect to the browser harness
  let session = null;
  let page;
  try {
    session = await openBrowserSession(args, { timeoutFallback: timeout });
    page = session.page;
  } catch (err) {
    console.error("Failed to open the browser regression harness.");
    console.error("Managed mode starts the app server automatically for localhost URLs.");
    console.error("To start it manually, run:");
    console.error("  pnpm dev");
    console.error("Optional manual browser lane:");
    console.error("  pnpm chrome");
    console.error(`\nError: ${err.message}`);
    if (session) {
      await closeBrowserSession(session);
    }
    process.exit(1);
  }

  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (session) {
      await closeBrowserSession(session);
      session = null;
      page = null;
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
        const artifacts = await collectFailureArtifacts(session, `reset-${test.name}`, err);
        results.push({ name: test.name, pass: false, message: `Reset failed: ${err.message}`, artifacts });
        failed++;
        continue;
      }

      // Run the test
      const startTime = Date.now();
      try {
        const result = await runRegressionTestWithChecks(page, test);
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
          const artifacts = await collectFailureArtifacts(
            session,
            `test-${test.name}`,
            new Error(result.message ?? `${test.name} returned pass=false`),
          );
          result.artifacts = artifacts;
          failed++;
        }

        results.push({
          name: test.name,
          pass: result.pass,
          skipped: Boolean(result.skipped),
          message: result.message,
          artifacts: result.artifacts ?? null,
          elapsed,
        });
      } catch (err) {
        const elapsed = Date.now() - startTime;
        if (shouldSkipMissingFixture(err, test, { allowMissingFixtures })) {
          console.log(`  SKIP  ${test.name} (${elapsed}ms) — ${err.message}`);
          results.push({ name: test.name, pass: true, skipped: true, message: err.message, elapsed });
          skipped++;
          continue;
        }
        // Detect Chrome disconnection — abort remaining tests
        if (err.message?.includes("Target closed") || err.message?.includes("Protocol error")) {
          console.log(`  FAIL  ${test.name} (${elapsed}ms) — Chrome disconnected`);
          console.error("\nChrome disconnected mid-test. Aborting remaining tests.");
          const artifacts = await collectFailureArtifacts(session, `test-${test.name}`, err);
          results.push({ name: test.name, pass: false, message: "Chrome disconnected", artifacts, elapsed });
          failed++;
          break;
        }
        console.log(`  FAIL  ${test.name} (${elapsed}ms) — Error: ${err.message}`);
        const artifacts = await collectFailureArtifacts(session, `test-${test.name}`, err);
        results.push({ name: test.name, pass: false, message: `Error: ${err.message}`, artifacts, elapsed });
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
          const artifactSuffix = r.artifacts ? ` (artifacts: ${r.artifacts})` : "";
          console.log(`  - ${r.name}: ${r.message ?? "no message"}${artifactSuffix}`);
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

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });
}
