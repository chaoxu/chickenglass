#!/usr/bin/env node
// Emit a flat, stable JSON dashboard snapshot derived from the existing
// perf-regression capture. See docs/perf-regression.md.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
  COGIRTH_MAIN2_FIXTURE,
  PUBLIC_SHOWCASE_FIXTURE,
  hasFixtureDocument,
} from "./fixture-test-helpers.mjs";
import {
  buildDashboardSnapshot,
  stableStringify,
} from "./perf-dashboard-lib.mjs";

function readArg(argv, flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return fallback;
  return argv[idx + 1] ?? fallback;
}

function hasArg(argv, flag) {
  return argv.includes(flag);
}

function resolveCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return "unknown";
}

function resolveFixtureLabel() {
  if (hasFixtureDocument(COGIRTH_MAIN2_FIXTURE)) {
    return "fixtures/cogirth/main2.md";
  }
  return PUBLIC_SHOWCASE_FIXTURE.virtualPath ?? "demo/index.md";
}

function printUsage() {
  console.log(`Usage: node scripts/perf-dashboard.mjs [options]

Options:
  --output <path>         Write JSON snapshot to <path> instead of stdout.
  --input <path>          Skip capture and read an existing perf-regression
                          report JSON to derive the dashboard from.
  --scenario <name>       Scenario to capture (default: typing-rich-burst).
  --iterations <n>        Iterations for capture (default: 3).
  --warmup <n>            Warmup iterations (default: 1).
  --help, -h              Show this help.

Any other flags are forwarded to scripts/perf-regression.mjs capture.

The dashboard automatically passes --heavy-doc when the cogirth heavy fixture
is present, falling back to demo/index.md otherwise.
`);
}

async function captureReport(argv) {
  const scenario = readArg(argv, "--scenario", "typing-rich-burst");
  const iterations = readArg(argv, "--iterations", "3");
  const warmup = readArg(argv, "--warmup", "1");
  const tmp = mkdtempSync(join(tmpdir(), "coflat-perf-dashboard-"));
  const outputPath = join(tmp, "report.json");

  const passthrough = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (
      flag === "--output"
      || flag === "--input"
      || flag === "--scenario"
      || flag === "--iterations"
      || flag === "--warmup"
    ) {
      i += 1; // skip its value
      continue;
    }
    passthrough.push(flag);
  }

  const heavyAvailable = hasFixtureDocument(COGIRTH_MAIN2_FIXTURE);
  const args = [
    "scripts/perf-regression.mjs",
    "capture",
    "--scenario",
    scenario,
    "--iterations",
    iterations,
    "--warmup",
    warmup,
    "--output",
    outputPath,
  ];
  if (heavyAvailable && !passthrough.includes("--heavy-doc")) {
    args.push("--heavy-doc");
  }
  args.push(...passthrough);

  const child = spawnSync("node", args, { stdio: "inherit" });
  if (child.status !== 0) {
    throw new Error(
      `perf-regression capture exited with status ${child.status}`,
    );
  }
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  if (hasArg(argv, "--help") || hasArg(argv, "-h")) {
    printUsage();
    return;
  }

  const inputPath = readArg(argv, "--input", null);
  let report;
  if (inputPath) {
    report = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  } else {
    report = await captureReport(argv);
  }

  const snapshot = buildDashboardSnapshot({
    report,
    commit: resolveCommit(),
    fixture: resolveFixtureLabel(),
  });
  const json = stableStringify(snapshot);

  const outputPath = readArg(argv, "--output", null);
  if (outputPath) {
    writeFileSync(resolve(outputPath), json);
    console.error(`Wrote dashboard snapshot to ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
}

const isDirectExec = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return entry.endsWith("perf-dashboard.mjs");
  } catch (_error) {
    return false;
  }
})();

if (isDirectExec) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exit(1);
  });
}
