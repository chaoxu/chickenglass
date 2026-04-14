import { relative, resolve, sep } from "node:path";
import process from "node:process";

import {
  git,
  gitMaybe,
  hasOriginMain,
  isBranchMerged,
  resolveRepoRoot,
} from "./shared.mjs";

// Parse `git worktree list --porcelain` into [{ path, HEAD, branch, bare, detached, prunable }]
function parsePorcelain(output) {
  const entries = [];
  let current = null;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "") {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (!current) current = {};
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.HEAD = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/foo"
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.detached = true;
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function listCoflatWorktrees(repoRoot) {
  const resolvedRoot = resolve(resolveRepoRoot(repoRoot));
  const porcelain = git(resolvedRoot, "worktree", "list", "--porcelain");
  const entries = parsePorcelain(porcelain);
  const managedPrefix = `${resolvedRoot}${sep}.worktrees${sep}`;
  return entries
    .filter((e) => e.path && e.path.startsWith(managedPrefix))
    .map((e) => {
      const name = relative(`${resolvedRoot}${sep}.worktrees`, e.path);
      return {
        name,
        path: e.path,
        branch: e.branch ?? null,
        head: e.HEAD ?? null,
        prunable: Boolean(e.prunable),
        detached: Boolean(e.detached),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function branchAge(repoRoot, branch) {
  if (!branch) return "unknown";
  const result = gitMaybe(repoRoot, "log", "-1", "--format=%cr", branch);
  if (result.status !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

export function runList({ repoRoot = process.cwd() } = {}) {
  const resolvedRoot = resolve(resolveRepoRoot(repoRoot));
  const worktrees = listCoflatWorktrees(resolvedRoot);

  if (worktrees.length === 0) {
    console.log("No Coflat-managed worktrees under .worktrees/.");
    return { worktrees: [] };
  }

  const originMainAvailable = hasOriginMain(resolvedRoot);
  if (!originMainAvailable) {
    console.log("(origin/main not fetched; merged? shown as unknown. Run `git fetch origin main`.)");
    console.log("");
  }

  const rows = worktrees.map((w) => {
    const merged = w.branch ? isBranchMerged(resolvedRoot, w.branch) : null;
    const mergedLabel = merged === null ? "unknown" : merged ? "yes" : "no";
    const age = w.branch ? branchAge(resolvedRoot, w.branch) : "unknown";
    return {
      name: w.name,
      branch: w.branch ?? (w.detached ? "(detached)" : "(none)"),
      age,
      merged: mergedLabel,
      path: w.path,
      prunable: w.prunable,
    };
  });

  const col = (vals) => Math.max(...vals.map((v) => v.length));
  const nameW = col(rows.map((r) => r.name).concat(["NAME"]));
  const branchW = col(rows.map((r) => r.branch).concat(["BRANCH"]));
  const ageW = col(rows.map((r) => r.age).concat(["AGE"]));
  const mergedW = col(rows.map((r) => r.merged).concat(["MERGED?"]));

  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  console.log(
    `${pad("NAME", nameW)}  ${pad("BRANCH", branchW)}  ${pad("AGE", ageW)}  ${pad("MERGED?", mergedW)}  PATH`,
  );
  for (const r of rows) {
    const suffix = r.prunable ? "  [prunable]" : "";
    console.log(
      `${pad(r.name, nameW)}  ${pad(r.branch, branchW)}  ${pad(r.age, ageW)}  ${pad(r.merged, mergedW)}  ${r.path}${suffix}`,
    );
  }

  return { worktrees: rows };
}
