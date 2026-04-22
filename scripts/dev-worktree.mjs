#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

function withoutGitEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

function usage() {
  return `Usage:
  pnpm dev:worktree -- <name> [--base <ref>] [--branch <branch>] [--path <path>] [--fetch]

Options:
  --base <ref>              Git ref to branch from (default: HEAD)
  --branch <branch>         Branch name to create (default: sanitized <name>)
  --path <path>             Worktree path (default: .worktrees/<sanitized-name>)
  --fetch                   Run 'git fetch origin main' before creating the worktree
  --no-link-node-modules    Skip linking repo node_modules into the new worktree
  --help                    Show this help

Examples:
  pnpm dev:worktree -- perf-444
  pnpm dev:worktree -- perf-444 --base origin/main --fetch
  node scripts/dev-worktree.mjs perf-444 --branch codex/perf-444
`;
}

function runCommand(command, args, cwd, check = true) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: withoutGitEnv(),
  });

  if (result.error) {
    throw result.error;
  }

  if (check && result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 0,
  };
}

function git(cwd, ...args) {
  return runCommand("git", args, cwd, true).stdout.trim();
}

function gitMaybe(cwd, ...args) {
  return runCommand("git", args, cwd, false);
}

export function sanitizeDevWorktreeName(value) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+|\.+$/g, "");

  const collapsed = sanitized.replace(/-+/g, "-");
  if (!collapsed) {
    throw new Error("Worktree name must contain at least one alphanumeric character.");
  }
  return collapsed;
}

export function resolveDefaultWorktreePath(repoRoot, name) {
  const stem = sanitizeDevWorktreeName(name);
  return join(repoRoot, ".worktrees", stem);
}

function resolveRequestedWorktreePath(repoRoot, requestedPath, fallbackName) {
  if (!requestedPath) {
    return resolve(resolveDefaultWorktreePath(repoRoot, fallbackName));
  }
  return isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(repoRoot, requestedPath);
}

function branchExists(repoRoot, branch) {
  const result = gitMaybe(repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
  return result.status === 0;
}

function isDirty(repoRoot) {
  return git(repoRoot, "status", "--short").length > 0;
}

function parseRemoteBaseRef(repoRoot, baseRef) {
  if (!baseRef || !baseRef.includes("/")) return null;

  const [remote, ...rest] = baseRef.split("/");
  if (!remote || rest.length === 0) return null;

  const remoteExists = gitMaybe(repoRoot, "remote", "get-url", remote).status === 0;
  if (!remoteExists) return null;

  return { remote, ref: rest.join("/") };
}

function linkNodeModules(repoRoot, worktreePath) {
  const source = join(repoRoot, "node_modules");
  const target = join(worktreePath, "node_modules");

  if (!existsSync(source) || existsSync(target)) {
    return false;
  }

  symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  return true;
}

export function createDevWorktree({
  repoRoot = process.cwd(),
  name,
  branch,
  path,
  baseRef = "HEAD",
  fetch = false,
  linkNodeModules: shouldLinkNodeModules = true,
} = {}) {
  if (!name && !branch) {
    throw new Error("Provide a worktree name or branch.");
  }

  const resolvedRepoRoot = resolve(git(repoRoot, "rev-parse", "--show-toplevel"));
  const resolvedBranch = branch ?? sanitizeDevWorktreeName(name);
  const resolvedPath = resolveRequestedWorktreePath(
    resolvedRepoRoot,
    path,
    name ?? resolvedBranch,
  );

  if (existsSync(resolvedPath)) {
    throw new Error(`Worktree path already exists: ${resolvedPath}`);
  }

  if (branchExists(resolvedRepoRoot, resolvedBranch)) {
    throw new Error(`Branch already exists: ${resolvedBranch}`);
  }

  if (fetch) {
    const remoteBaseRef = parseRemoteBaseRef(resolvedRepoRoot, baseRef);
    if (remoteBaseRef) {
      runCommand("git", ["fetch", remoteBaseRef.remote, remoteBaseRef.ref], resolvedRepoRoot, true);
    } else {
      runCommand("git", ["fetch", "origin", "main"], resolvedRepoRoot, true);
    }
  }

  const rootDirty = isDirty(resolvedRepoRoot);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  runCommand(
    "git",
    ["worktree", "add", resolvedPath, "-b", resolvedBranch, baseRef],
    resolvedRepoRoot,
    true,
  );

  const linkedNodeModules = shouldLinkNodeModules
    ? linkNodeModules(resolvedRepoRoot, resolvedPath)
    : false;

  return {
    repoRoot: resolvedRepoRoot,
    branch: resolvedBranch,
    worktreePath: resolvedPath,
    baseRef,
    rootDirty,
    linkedNodeModules,
    nodeModulesPath: join(resolvedPath, "node_modules"),
  };
}

function printSummary(result) {
  console.log(`Created worktree: ${result.worktreePath}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Base: ${result.baseRef}`);

  if (result.linkedNodeModules) {
    console.log("Dependencies: linked repo node_modules");
  } else if (existsSync(join(result.repoRoot, "node_modules"))) {
    console.log("Dependencies: repo node_modules already available in worktree");
  } else {
    console.log("Dependencies: run 'pnpm install' inside the worktree");
  }

  if (result.rootDirty) {
    console.log("Note: repo has uncommitted changes; the new worktree includes only committed history.");
  }

  console.log(`Next: cd ${result.worktreePath}`);
}

function parseArgs(argv) {
  const options = {
    baseRef: "HEAD",
    fetch: false,
    linkNodeModules: true,
  };

  const requireValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

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

  if (positionals.length > 1) {
    throw new Error("Provide only one worktree name.");
  }

  options.name = positionals[0];
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (!options.name && !options.branch) {
      throw new Error("Provide a worktree name.");
    }

    const result = createDevWorktree(options);
    printSummary(result);
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
