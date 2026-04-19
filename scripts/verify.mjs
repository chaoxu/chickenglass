#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

import { createArgParser } from "./cli-args.mjs";
import { writeLastVerifyStatus } from "./devx-cache.mjs";
import { ensureNodeModulesLink } from "./dev-worktree/deps.mjs";
import { startOrReuseDevServer } from "./dev-server.mjs";

const DEFAULT_BROWSER_GROUP = "core";

function usage() {
  return `Usage:
  pnpm verify [options]
  pnpm verify:quick
  pnpm verify:browser

Options:
  --browser-group <name>   Browser regression group to run (default: ${DEFAULT_BROWSER_GROUP})
  --full-browser           Run the full browser regression suite
  --no-browser             Skip browser regressions
  --only-browser           Skip typecheck/lint/unit/knip/build and only run browser regressions
  --no-build               Skip production build
  --url <url>              Reuse an already-running app URL instead of starting Vite
  --headed                 Show the managed browser
  -h, --help               Show this help
`;
}

function runStep(name, command, args, options = {}) {
  const startedAt = Date.now();
  console.log(`\n[verify] ${name}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  const elapsedMs = Date.now() - startedAt;
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(`${name} failed with exit code ${result.status ?? "unknown"}.`);
    error.step = name;
    error.elapsedMs = elapsedMs;
    throw error;
  }
  return {
    elapsedMs,
    name,
    status: "passed",
  };
}

async function runBrowserStep(argv, steps) {
  const parser = createArgParser(argv);
  const url = parser.getFlag("--url");
  const fullBrowser = parser.hasFlag("--full-browser");
  const browserGroup = parser.getFlag("--browser-group", DEFAULT_BROWSER_GROUP);
  const server = await startOrReuseDevServer({ url });

  try {
    const args = ["scripts/test-regression.mjs", "--url", server.url, "--browser", "managed"];
    if (!fullBrowser) {
      args.push("--group", browserGroup);
    }
    if (parser.hasFlag("--headed")) {
      args.push("--headed");
    }
    steps.push(runStep(
      fullBrowser ? "browser regressions (full)" : `browser regressions (${browserGroup})`,
      "node",
      args,
    ));
  } finally {
    await server.stop();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parser = createArgParser(argv);
  if (parser.hasFlag("--help") || parser.hasFlag("-h")) {
    console.log(usage());
    return;
  }

  const startedAt = new Date();
  const steps = [];
  const onlyBrowser = parser.hasFlag("--only-browser");
  const skipBrowser = parser.hasFlag("--no-browser");
  const skipBuild = parser.hasFlag("--no-build");

  try {
    const deps = ensureNodeModulesLink();
    if (!deps.ok) {
      throw new Error(deps.message ?? "Unable to prepare node_modules.");
    }

    if (!onlyBrowser) {
      steps.push(runStep("typecheck", "pnpm", ["typecheck"]));
      steps.push(runStep("lint", "pnpm", ["lint"]));
      steps.push(runStep("unit tests", "pnpm", ["test"]));
      steps.push(runStep("knip", "pnpm", ["knip"]));
      if (!skipBuild) {
        steps.push(runStep("build", "pnpm", ["build"]));
      }
    }

    if (!skipBrowser) {
      await runBrowserStep(argv, steps);
    }

    const result = {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      ok: true,
      steps,
    };
    writeLastVerifyStatus(result);
    console.log("\n[verify] passed");
  } catch (error) {
    const result = {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      steps,
    };
    writeLastVerifyStatus(result);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
