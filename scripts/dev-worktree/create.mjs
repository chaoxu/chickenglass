import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

import {
  branchExists,
  git,
  gitMaybe,
  resolveRepoRoot,
  runCommand,
  sanitizeDevWorktreeName,
} from "./shared.mjs";

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

  const resolvedRepoRoot = resolve(resolveRepoRoot(repoRoot));
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

export function printCreateSummary(result) {
  console.log(`Created worktree: ${result.worktreePath}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Base: ${result.baseRef}`);

  if (result.linkedNodeModules) {
    console.log("Dependencies: linked repo node_modules");
  } else if (existsSync(join(result.repoRoot, "node_modules"))) {
    console.log("Dependencies: repo node_modules already available in worktree");
  } else {
    console.log("Dependencies: run 'npm install' inside the worktree");
  }

  if (result.rootDirty) {
    console.log(
      "Note: repo has uncommitted changes; the new worktree includes only committed history.",
    );
  }

  console.log(`Next: cd ${result.worktreePath}`);
}
