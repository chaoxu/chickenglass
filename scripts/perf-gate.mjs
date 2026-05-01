#!/usr/bin/env node
// Compare a freshly-captured dashboard snapshot against the checked-in
// perf-baseline.json using the perf-gate threshold logic.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
  buildDashboardSnapshot,
  stableStringify,
} from "./perf-dashboard-lib.mjs";
import {
  PERF_GATE_DEFAULTS,
  comparePerfDashboard,
  formatGateReport,
} from "./perf-gate-lib.mjs";
import {
  COGIRTH_MAIN2_FIXTURE,
  PUBLIC_SHOWCASE_FIXTURE,
  hasFixtureDocument,
} from "./fixture-test-helpers.mjs";

const REPO_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const DEFAULT_BASELINE = resolve(REPO_ROOT, "perf-baseline.json");

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
  if (result.status === 0) return result.stdout.trim();
  return "unknown";
}

function resolveFixtureLabel() {
  if (hasFixtureDocument(COGIRTH_MAIN2_FIXTURE)) {
    return "fixtures/cogirth/main2.md";
  }
  return PUBLIC_SHOWCASE_FIXTURE.virtualPath ?? "demo/index.md";
}

function printUsage() {
  console.log(`Usage: node scripts/perf-gate.mjs [options]

Options:
  --baseline <path>           Baseline dashboard snapshot (default: ./perf-baseline.json)
  --current <path>            Use a pre-captured dashboard snapshot instead of capturing
  --threshold-multiplier <x>  Per-metric ratio gate (default: ${PERF_GATE_DEFAULTS.thresholdMultiplier})
  --min-delta-ms <n>          Min absolute ms delta before flagging (default: ${PERF_GATE_DEFAULTS.minDeltaMs})
  --json                      Emit machine-readable JSON instead of a table
  --soft                      Always exit 0 even if a regression is detected (CI soft gate)
  --scenario <name>           Scenario to capture (default: typing-rich-burst)
  --iterations <n>            Iterations for capture (default: 3)
  --warmup <n>                Warmup iterations (default: 1)
  --help, -h                  Show this help.

Any other flags are forwarded to scripts/perf-regression.mjs capture.
`);
}

async function captureSnapshot(argv) {
  const scenario = readArg(argv, "--scenario", "typing-rich-burst");
  const iterations = readArg(argv, "--iterations", "3");
  const warmup = readArg(argv, "--warmup", "1");
  const tmp = mkdtempSync(join(tmpdir(), "coflat-perf-gate-"));
  const outputPath = join(tmp, "report.json");

  const passthrough = [];
  const consumed = new Set([
    "--baseline",
    "--current",
    "--threshold-multiplier",
    "--min-delta-ms",
    "--scenario",
    "--iterations",
    "--warmup",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (consumed.has(flag)) {
      i += 1;
      continue;
    }
    if (flag === "--json" || flag === "--soft") continue;
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
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  return buildDashboardSnapshot({
    report,
    commit: resolveCommit(),
    fixture: resolveFixtureLabel(),
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (hasArg(argv, "--help") || hasArg(argv, "-h")) {
    printUsage();
    return 0;
  }

  const baselinePath = resolve(readArg(argv, "--baseline", DEFAULT_BASELINE));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

  const currentPath = readArg(argv, "--current", null);
  const current = currentPath
    ? JSON.parse(readFileSync(resolve(currentPath), "utf8"))
    : await captureSnapshot(argv);

  const thresholdMultiplier = Number(
    readArg(argv, "--threshold-multiplier", PERF_GATE_DEFAULTS.thresholdMultiplier),
  );
  const minDeltaMs = Number(
    readArg(argv, "--min-delta-ms", PERF_GATE_DEFAULTS.minDeltaMs),
  );

  const result = comparePerfDashboard(baseline, current, {
    thresholdMultiplier,
    minDeltaMs,
  });

  if (hasArg(argv, "--json")) {
    process.stdout.write(stableStringify(result));
  } else {
    console.log(formatGateReport(result));
  }

  if (!result.ok && !hasArg(argv, "--soft")) {
    return 1;
  }
  return 0;
}

const isDirectExec = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return entry.endsWith("perf-gate.mjs");
  } catch (_error) {
    return false;
  }
})();

if (isDirectExec) {
  main().then((code) => {
    process.exit(code ?? 0);
  }).catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exit(1);
  });
}
