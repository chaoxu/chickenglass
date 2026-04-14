#!/usr/bin/env node

import process from "node:process";

import {
  createDevWorktree,
  printCreateSummary,
  resolveDefaultWorktreePath,
} from "./dev-worktree/create.mjs";
import { runList } from "./dev-worktree/list.mjs";
import { runPrune } from "./dev-worktree/prune.mjs";
import { runRemove } from "./dev-worktree/remove.mjs";
import { sanitizeDevWorktreeName } from "./dev-worktree/shared.mjs";

// Re-exports preserved for tests and downstream imports.
export {
  createDevWorktree,
  resolveDefaultWorktreePath,
  sanitizeDevWorktreeName,
};

const SUBCOMMANDS = new Set(["list", "remove", "prune"]);

function usage() {
  return `Usage:
  pnpm dev:worktree -- <name> [--base <ref>] [--branch <branch>] [--path <path>] [--fetch]
  pnpm dev:worktree list
  pnpm dev:worktree remove <name> [--force] [--even-if-unmerged]
  pnpm dev:worktree prune [--dry-run] [--force]

Create options:
  --base <ref>              Git ref to branch from (default: HEAD)
  --branch <branch>         Branch name to create (default: sanitized <name>)
  --path <path>             Worktree path (default: .worktrees/<sanitized-name>)
  --fetch                   Run 'git fetch origin main' before creating the worktree
  --no-link-node-modules    Skip linking repo node_modules into the new worktree

Remove options:
  --force                   Remove even if the worktree is dirty or the branch is unmerged
  --even-if-unmerged        Delete the branch even if not merged into origin/main (keeps dirty-check)

Prune options:
  --dry-run                 Show what would be pruned/deleted without making changes
  --force                   Also delete unmerged managed branches

General:
  --help, -h                Show this help

Examples:
  pnpm dev:worktree -- perf-444
  pnpm dev:worktree -- perf-444 --base origin/main --fetch
  pnpm dev:worktree list
  pnpm dev:worktree remove perf-444
  pnpm dev:worktree prune --dry-run
`;
}

function parseArgs(argv) {
  const options = {
    baseRef: "HEAD",
    fetch: false,
    linkNodeModules: true,
    dryRun: false,
    force: false,
    evenIfUnmerged: false,
  };

  const requireValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

  // Detect subcommand from the first non-flag token.
  let subcommand = null;
  if (argv.length > 0 && SUBCOMMANDS.has(argv[0])) {
    subcommand = argv[0];
    argv = argv.slice(1);
  }

  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--fetch") {
      options.fetch = true;
      continue;
    }
    if (arg === "--no-link-node-modules") {
      options.linkNodeModules = false;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--even-if-unmerged") {
      options.evenIfUnmerged = true;
      continue;
    }
    if (arg === "--base") {
      options.baseRef = requireValue(arg, i);
      i += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = requireValue(arg, i);
      i += 1;
      continue;
    }
    if (arg === "--path") {
      options.path = requireValue(arg, i);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (subcommand === null) {
    if (positionals.length > 1) {
      throw new Error("Provide only one worktree name.");
    }
    options.name = positionals[0];
  } else if (subcommand === "remove") {
    if (positionals.length !== 1) {
      throw new Error("`remove` requires exactly one worktree name.");
    }
    options.name = positionals[0];
  } else if (positionals.length > 0) {
    throw new Error(`\`${subcommand}\` does not take positional arguments.`);
  }

  options.subcommand = subcommand;
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    if (options.subcommand === "list") {
      runList();
      return;
    }
    if (options.subcommand === "remove") {
      runRemove({
        name: options.name,
        force: options.force,
        evenIfUnmerged: options.evenIfUnmerged,
      });
      return;
    }
    if (options.subcommand === "prune") {
      runPrune({ dryRun: options.dryRun, force: options.force });
      return;
    }

    if (!options.name && !options.branch) {
      throw new Error("Provide a worktree name.");
    }
    const result = createDevWorktree(options);
    printCreateSummary(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
