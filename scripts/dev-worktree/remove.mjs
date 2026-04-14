import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { resolveDefaultWorktreePath } from "./create.mjs";
import { listCoflatWorktrees } from "./list.mjs";
import {
  branchExists,
  git,
  gitMaybe,
  isBranchMerged,
  resolveRepoRoot,
  sanitizeDevWorktreeName,
} from "./shared.mjs";

function worktreeIsDirty(worktreePath) {
  const result = gitMaybe(worktreePath, "status", "--short");
  if (result.status !== 0) return false;
  return result.stdout.trim().length > 0;
}

export function runRemove({
  repoRoot = process.cwd(),
  name,
  force = false,
  evenIfUnmerged = false,
} = {}) {
  if (!name) {
    throw new Error("Provide a worktree name to remove.");
  }

  const resolvedRoot = resolve(resolveRepoRoot(repoRoot));
  const sanitized = sanitizeDevWorktreeName(name);
  const targetPath = resolveDefaultWorktreePath(resolvedRoot, sanitized);

  // Find the matching worktree entry; prefer live data (handles the
  // manually-deleted-directory case by degrading gracefully).
  const entries = listCoflatWorktrees(resolvedRoot);
  const entry = entries.find((e) => e.name === sanitized || e.path === targetPath);

  const branch = entry?.branch ?? sanitized;
  const pathOnDisk = entry?.path ?? targetPath;

  if (!entry && !existsSync(targetPath) && !branchExists(resolvedRoot, branch)) {
    throw new Error(
      `No worktree or branch matches "${sanitized}". Try \`pnpm dev:worktree list\`.`,
    );
  }

  if (existsSync(pathOnDisk) && worktreeIsDirty(pathOnDisk)) {
    if (!force) {
      throw new Error(
        `Worktree at ${pathOnDisk} has uncommitted changes. Pass --force to remove anyway.`,
      );
    }
    console.log(`Warning: worktree at ${pathOnDisk} has uncommitted changes; removing with --force.`);
  }

  if (branchExists(resolvedRoot, branch)) {
    const merged = isBranchMerged(resolvedRoot, branch);
    if (merged === false && !force && !evenIfUnmerged) {
      throw new Error(
        `Branch "${branch}" is not merged into origin/main. Pass --even-if-unmerged or --force to delete anyway.`,
      );
    }
    if (merged === null && !force && !evenIfUnmerged) {
      throw new Error(
        `Cannot verify "${branch}" is merged (origin/main unavailable). Run \`git fetch origin main\` or pass --force/--even-if-unmerged.`,
      );
    }
  }

  // Remove worktree. Use `--force` when the directory is missing or dirty.
  if (existsSync(pathOnDisk) || entry) {
    const wtArgs = ["worktree", "remove"];
    if (force) wtArgs.push("--force");
    wtArgs.push(pathOnDisk);
    const wtResult = gitMaybe(resolvedRoot, ...wtArgs);
    if (wtResult.status !== 0 && !force) {
      throw new Error(
        `git worktree remove failed: ${wtResult.stderr.trim() || wtResult.stdout.trim()}`,
      );
    }
    if (wtResult.status !== 0 && force) {
      // Best effort: prune metadata
      gitMaybe(resolvedRoot, "worktree", "prune");
    }
    console.log(`Removed worktree: ${pathOnDisk}`);
  } else {
    // No on-disk worktree; ensure metadata is clean.
    gitMaybe(resolvedRoot, "worktree", "prune");
  }

  // Delete branch if still present.
  if (branchExists(resolvedRoot, branch)) {
    const flag = force ? "-D" : "-d";
    git(resolvedRoot, "branch", flag, branch);
    console.log(`Deleted branch: ${branch}`);
  }

  return { name: sanitized, branch, path: pathOnDisk };
}
