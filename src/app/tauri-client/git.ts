import { invokeWithPerf } from "../perf";

export interface GitBranchInfo {
  branch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export function gitBranchInfoCommand(): Promise<GitBranchInfo> {
  return invokeWithPerf<GitBranchInfo>("git_branch_info");
}

export function gitPullCommand(): Promise<string> {
  return invokeWithPerf<string>("git_pull");
}

export function gitPushCommand(): Promise<string> {
  return invokeWithPerf<string>("git_push");
}

export interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
}

/** Prefix returned by the backend for dirty-worktree errors. */
export const DIRTY_WORKTREE_PREFIX = "DIRTY_WORKTREE: ";

export function isDirtyWorktreeError(error: unknown): boolean {
  return typeof error === "string" && error.startsWith(DIRTY_WORKTREE_PREFIX);
}

export function gitCurrentBranchCommand(): Promise<string | null> {
  return invokeWithPerf<string | null>("git_current_branch");
}

export function gitListBranchesCommand(): Promise<GitBranchEntry[]> {
  return invokeWithPerf<GitBranchEntry[]>("git_list_branches");
}

export function gitSwitchBranchCommand(name: string, force = false): Promise<void> {
  return invokeWithPerf("git_switch_branch", { name, force });
}

export function gitCreateBranchCommand(name: string, force = false): Promise<void> {
  return invokeWithPerf("git_create_branch", { name, force });
}

/** Git working-tree status for a single file. */
export type GitFileStatus = "modified" | "added" | "untracked";

/** Map from project-relative path to its git status. */
export type GitStatusMap = Record<string, GitFileStatus>;

export function gitStatusCommand(): Promise<GitStatusMap> {
  return invokeWithPerf<GitStatusMap>("git_status");
}
