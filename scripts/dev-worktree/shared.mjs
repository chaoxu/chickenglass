import { spawnSync } from "node:child_process";
import process from "node:process";

// Strip git env vars so child git calls don't inherit GIT_DIR / core.hooksPath
// from a parent git context (e.g. when this script or its tests run inside a
// git hook). Otherwise sub-gits try to operate on the parent repo, not on
// the target tmp/worktree directories the script manages.
export function childEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_NAMESPACE;
  delete env.GIT_PREFIX;
  return env;
}

export function runCommand(command, args, cwd, check = true) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: childEnv(),
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

export function git(cwd, ...args) {
  return runCommand("git", args, cwd, true).stdout.trim();
}

export function gitMaybe(cwd, ...args) {
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

export function resolveRepoRoot(repoRoot) {
  return git(repoRoot, "rev-parse", "--show-toplevel");
}

export function branchExists(repoRoot, branch) {
  const result = gitMaybe(repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
  return result.status === 0;
}

// Returns true if origin/main is a known ref in this repo.
export function hasOriginMain(repoRoot) {
  const result = gitMaybe(
    repoRoot,
    "show-ref",
    "--verify",
    "--quiet",
    "refs/remotes/origin/main",
  );
  return result.status === 0;
}

// Returns true if `branch`'s HEAD is reachable from `origin/main`.
// Returns null when origin/main is not available.
export function isBranchMerged(repoRoot, branch) {
  if (!hasOriginMain(repoRoot)) return null;
  const result = gitMaybe(
    repoRoot,
    "merge-base",
    "--is-ancestor",
    branch,
    "origin/main",
  );
  return result.status === 0;
}
