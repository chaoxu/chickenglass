#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { splitCliCommand } from "./devx-cli.mjs";

export const DEFAULT_REPO = "chaoxu/coflat";

const COMMANDS = ["list", "view", "create", "comment", "close"];

function extractValueFlag(args, flag, fallback) {
  const result = [];
  let value = fallback;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      value = args[index + 1] ?? fallback;
      if (args[index + 1] !== undefined) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith(`${flag}=`)) {
      value = arg.slice(flag.length + 1);
      continue;
    }
    result.push(arg);
  }
  return { args: result, value };
}

export function buildTeaIssueArgs(argv = []) {
  const { command, options } = splitCliCommand(argv, COMMANDS, "list");
  const { args, value: repo } = extractValueFlag(options, "--repo", DEFAULT_REPO);

  switch (command) {
    case "list":
      return ["issues", "--repo", repo, ...args];
    case "view":
      return ["issues", "--repo", repo, ...args];
    case "create":
      return ["issues", "create", "--repo", repo, ...args];
    case "comment":
      return ["comment", "--repo", repo, ...args];
    case "close":
      return ["issues", "close", "--repo", repo, ...args];
    default:
      throw new Error(`Unknown issue command: ${command}`);
  }
}

export function printIssueHelp(stream = process.stdout) {
  stream.write(`Usage:
  pnpm issue -- list [tea options]
  pnpm issue -- view <number>
  pnpm issue -- create --title "..." --description "..."
  pnpm issue -- comment <number> "..."
  pnpm issue -- close <number>

All commands default to --repo ${DEFAULT_REPO}.
`);
}

export function runTeaIssue(argv = process.argv.slice(2), options = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printIssueHelp(options.stdout ?? process.stdout);
    return 0;
  }

  const tea = options.teaCommand ?? "tea";
  const teaArgs = buildTeaIssueArgs(argv);
  const result = spawnSync(tea, teaArgs, {
    stdio: "inherit",
    ...options.spawnOptions,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runTeaIssue());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
