import { tauriCommand, tauriArgs } from "./make-command";

export interface GitBranchInfo {
  branch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
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

/** Git working-tree status for a single file (used by file-tree badges). */
export type GitFileStatus = "modified" | "added" | "untracked";

/** Map from project-relative path to its git status (used by file-tree badges). */
export type GitStatusMap = Record<string, GitFileStatus>;

export interface GitStatusEntry {
  path: string;
  staged: string | null;
  unstaged: string | null;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  files: GitStatusEntry[];
}

export interface GitCommitResult {
  oid: string;
}

export const gitBranchInfoCommand = tauriCommand<GitBranchInfo>("git_branch_info");
export const gitPullCommand = tauriCommand<string>("git_pull");
export const gitPushCommand = tauriCommand<string>("git_push");
export const gitCurrentBranchCommand = tauriCommand<string | null>("git_current_branch");
export const gitListBranchesCommand = tauriCommand<GitBranchEntry[]>("git_list_branches");
export const gitSwitchBranchCommand = tauriArgs<undefined>("git_switch_branch")((name: string, force = false) => ({ name, force }));
export const gitCreateBranchCommand = tauriArgs<undefined>("git_create_branch")((name: string, force = false) => ({ name, force }));
export const gitStatusCommand = tauriCommand<GitStatusResult>("git_status");
export const gitStageCommand = tauriArgs<undefined>("git_stage")((paths: string[]) => ({ paths }));
export const gitUnstageCommand = tauriArgs<undefined>("git_unstage")((paths: string[]) => ({ paths }));
export const gitCommitCommand = tauriArgs<GitCommitResult>("git_commit")((message: string) => ({ message }));
