#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

export const BROWSER_LANES = {
  lexical: {
    args: ["--scenario", "lexical"],
    description: "Lexical WYSIWYG smoke lane",
  },
  render: {
    args: ["--filter", "headings,math-render,index-open-rich-render"],
    description: "CM6 rich render smoke lane",
  },
  scroll: {
    args: ["--filter", "scroll-jump-rankdecrease"],
    description: "Scroll-jump regression lane",
  },
  smoke: {
    args: ["--scenario", "smoke"],
    description: "Merged-app smoke lane",
  },
};

const COMMANDS = ["one", ...Object.keys(BROWSER_LANES)];

function normalizePackageArgs(argv) {
  return argv[0] === "--" ? argv.slice(1) : [...argv];
}

function splitOneOptions(options) {
  const separatorIndex = options.indexOf("--");
  if (separatorIndex < 0) {
    return { filters: options, runnerArgs: [] };
  }
  return {
    filters: options.slice(0, separatorIndex),
    runnerArgs: options.slice(separatorIndex + 1),
  };
}

export function buildBrowserLaneArgs(argv = []) {
  const normalized = normalizePackageArgs(argv);
  const [first, ...rest] = normalized;
  const hasExplicitCommand = COMMANDS.includes(first);
  const command = hasExplicitCommand ? first : "smoke";
  const options = hasExplicitCommand ? rest : normalized;

  if (command === "one") {
    const { filters, runnerArgs } = splitOneOptions(options);
    const filter = filters.join(",").replaceAll(/\s+/g, "");
    if (!filter) {
      throw new Error("browser lane `one` requires at least one regression test name.");
    }
    return ["scripts/test-regression.mjs", "--filter", filter, ...runnerArgs];
  }

  const lane = BROWSER_LANES[command];
  if (!lane) {
    throw new Error(`Unknown browser lane: ${command}`);
  }

  return [
    "scripts/test-regression.mjs",
    ...lane.args,
    ...options,
  ];
}

export function formatBrowserLaneHelp() {
  const lines = [
    "Usage:",
    "  pnpm test:browser:quick",
    "  pnpm test:browser:quick -- --headed",
    "  pnpm test:browser:quick -- render --headed",
    "  pnpm test:browser:quick -- one headings math-render -- --headed",
    "",
    "Lanes:",
  ];
  for (const [name, lane] of Object.entries(BROWSER_LANES)) {
    lines.push(`  ${name.padEnd(8)} ${lane.description}`);
  }
  return lines.join("\n");
}

export function runBrowserLaneCli(argv = process.argv.slice(2), options = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    (options.stdout ?? process.stdout).write(`${formatBrowserLaneHelp()}\n`);
    return 0;
  }

  const args = buildBrowserLaneArgs(argv);
  const result = (options.spawnSync ?? spawnSync)("node", args, {
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runBrowserLaneCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
