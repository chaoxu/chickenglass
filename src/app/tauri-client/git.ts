import { invokeWithPerf } from "../perf";

export interface GitBranchInfo {
  readonly branch: string;
  readonly isDetached: boolean;
}

export function getGitBranchCommand(): Promise<GitBranchInfo | null> {
  return invokeWithPerf<GitBranchInfo | null>("get_git_branch");
}
