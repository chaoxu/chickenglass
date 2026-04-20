import { resolve } from "node:path";
import process from "node:process";

import { listCoflatWorktrees } from "./list.mjs";
import {
  git,
  gitMaybe,
  isManagedWorktreeBranch,
  isBranchMerged,
  resolveRepoRoot,
} from "./shared.mjs";

// List local branch names.
function localBranches(repoRoot) {
  const out = git(repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads/");
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

export function runPrune({
  repoRoot = process.cwd(),
  dryRun = false,
  force = false,
} = {}) {
  const resolvedRoot = resolve(resolveRepoRoot(repoRoot));

  if (dryRun) {
    const pruneResult = gitMaybe(resolvedRoot, "worktree", "prune", "--dry-run");
    const pruneOutput = pruneResult.stdout.trim();
    if (pruneOutput) {
      console.log("Would prune worktree metadata:");
      console.log(pruneOutput);
    } else {
      console.log("No worktree metadata to prune.");
    }
  } else {
    const pruneResult = gitMaybe(resolvedRoot, "worktree", "prune", "--verbose");
    const pruneOutput = pruneResult.stdout.trim();
    if (pruneOutput) {
      console.log("Pruned worktree metadata:");
      console.log(pruneOutput);
    }
  }

  // Collect branch names still attached to a worktree so we don't try to
  // delete them.
  const liveBranches = new Set(
    listCoflatWorktrees(resolvedRoot)
      .map((w) => w.branch)
      .filter(Boolean),
  );

  const candidates = localBranches(resolvedRoot)
    .filter((b) => !liveBranches.has(b))
    .filter((b) => isManagedWorktreeBranch(resolvedRoot, b));

  const deletable = [];
  const skipped = [];
  for (const branch of candidates) {
    const merged = isBranchMerged(resolvedRoot, branch);
    if (merged === true) {
      deletable.push({ branch, reason: "merged into origin/main" });
    } else if (merged === false) {
      if (force) {
        deletable.push({ branch, reason: "unmerged (force)" });
      } else {
        skipped.push({ branch, reason: "not merged into origin/main" });
      }
    } else {
      skipped.push({ branch, reason: "origin/main unavailable" });
    }
  }

  if (deletable.length === 0) {
    console.log("No managed branches eligible for deletion.");
  } else {
    console.log(dryRun ? "Would delete branches:" : "Deleting branches:");
    for (const { branch, reason } of deletable) {
      console.log(`  ${branch}  (${reason})`);
      if (!dryRun) {
        const flag = force ? "-D" : "-d";
        const result = gitMaybe(resolvedRoot, "branch", flag, branch);
        if (result.status !== 0) {
          console.log(`    skipped: ${result.stderr.trim() || result.stdout.trim()}`);
        }
      }
    }
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped branches:");
    for (const { branch, reason } of skipped) {
      console.log(`  ${branch}  (${reason})`);
    }
    console.log("Pass --force to delete unmerged branches.");
  }

  return { deleted: dryRun ? [] : deletable, skipped, dryRun };
}
