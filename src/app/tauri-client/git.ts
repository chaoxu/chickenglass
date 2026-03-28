import { invokeWithPerf } from "../perf";

export interface GitBranchInfo {
  readonly branch: string;
  readonly isDetached: boolean;
}

export function getGitBranchCommand(): Promise<GitBranchInfo | null> {
  return invokeWithPerf<GitBranchInfo | null>("get_git_branch");
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
