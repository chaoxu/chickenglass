#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { ensureNodeModulesLink } from "./dev-worktree/deps.mjs";
import { startOrReuseDevServer } from "./dev-server.mjs";

const DEFAULT_BASELINE = ".cache/devx/perf-baseline.json";
const DEFAULT_SCENARIO = "typing-lexical-burst";

function usage() {
  return `Usage:
  pnpm perf:baseline [options]
  pnpm perf:check [options]
  node scripts/perf-workflow.mjs baseline [options]
  node scripts/perf-workflow.mjs check [options]

Options:
  --scenario <name>        Perf scenario (default: ${DEFAULT_SCENARIO})
  --baseline <path>        Baseline path for check (default: ${DEFAULT_BASELINE})
  --output <path>          Baseline output path for baseline (default: ${DEFAULT_BASELINE})
  --url <url>              Reuse an already-running app URL instead of starting Vite
  --headed                 Show the managed browser
  --iterations <n>         Forwarded to perf-regression
  --warmup <n>             Forwarded to perf-regression
  --threshold-pct <n>      Forwarded to perf-regression check
  --min-delta-ms <n>       Forwarded to perf-regression check
  -h, --help               Show this help
`;
}

function getFlag(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function forwardIfPresent(source, target, flag) {
  const index = source.indexOf(flag);
  if (index >= 0 && index + 1 < source.length) {
    target.push(flag, source[index + 1]);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] === "check" || argv[0] === "baseline" ? argv[0] : "baseline";
  const options = command === argv[0] ? argv.slice(1) : argv;
  if (hasFlag(options, "--help") || hasFlag(options, "-h")) {
    console.log(usage());
    return;
  }

  const deps = ensureNodeModulesLink();
  if (!deps.ok) {
    throw new Error(deps.message ?? "Unable to prepare node_modules.");
  }

  const scenario = getFlag(options, "--scenario", DEFAULT_SCENARIO);
  const baselinePath = resolve(getFlag(options, "--baseline", DEFAULT_BASELINE));
  const outputPath = resolve(getFlag(options, "--output", DEFAULT_BASELINE));
  const server = await startOrReuseDevServer({ url: getFlag(options, "--url") });

  try {
    const perfArgs = [
      "scripts/perf-regression.mjs",
      command === "check" ? "compare" : "capture",
      "--scenario",
      scenario,
      "--url",
      server.url,
      "--browser",
      "managed",
      "--heavy-doc",
    ];

    if (command === "check") {
      perfArgs.push("--baseline", baselinePath);
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
      perfArgs.push("--output", outputPath);
    }

    for (const flag of ["--iterations", "--warmup", "--threshold-pct", "--min-delta-ms", "--settle-ms"]) {
      forwardIfPresent(options, perfArgs, flag);
    }
    if (hasFlag(options, "--headed")) {
      perfArgs.push("--headed");
    }

    const result = spawnSync("node", perfArgs, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
    }
  } finally {
    await server.stop();
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
