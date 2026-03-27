import { useState, useCallback, useEffect } from "react";
import { isTauri } from "../../lib/tauri";

// Lazy-loaded to keep tauri git client out of browser startup chunk.
const gitClient = () => import("../tauri-client/git");
const confirmModule = () => import("../confirm-action");

export interface GitBranchController {
  /** Current branch name, or null if not a git repo / not in Tauri. */
  currentBranch: string | null;
  /** Refresh the current branch from git. */
  refreshBranch: () => Promise<void>;
  /** Switch to an existing branch. Prompts on dirty worktree. */
  switchBranch: (name: string) => Promise<void>;
  /** Create and switch to a new branch. Prompts on dirty worktree. */
  createBranch: (name: string) => Promise<void>;
}

interface UseGitBranchOptions {
  projectRoot: string | null;
  refreshTree: () => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  currentPath: string | null;
}

export function useGitBranch({
  projectRoot,
  refreshTree,
  reloadFile,
  currentPath,
}: UseGitBranchOptions): GitBranchController {
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  const refreshBranch = useCallback(async () => {
    if (!isTauri() || !projectRoot) {
      setCurrentBranch(null);
      return;
    }
    try {
      const { gitCurrentBranchCommand } = await gitClient();
      const branch = await gitCurrentBranchCommand();
      setCurrentBranch(branch);
    } catch {
      setCurrentBranch(null);
    }
  }, [projectRoot]);

  // Fetch branch on project open / change.
  useEffect(() => {
    void refreshBranch();
  }, [refreshBranch]);

  const afterBranchChange = useCallback(async () => {
    await refreshBranch();
    await refreshTree();
    if (currentPath) {
      try {
        await reloadFile(currentPath);
      } catch {
        // File may not exist on the new branch — that's OK.
      }
    }
  }, [refreshBranch, refreshTree, reloadFile, currentPath]);

  /**
   * Try an operation, and if the backend returns a DIRTY_WORKTREE error,
   * prompt the user for confirmation and retry with force=true.
   */
  const withDirtyConfirmation = useCallback(async (
    action: (force: boolean) => Promise<void>,
  ): Promise<void> => {
    const { isDirtyWorktreeError } = await gitClient();
    try {
      await action(false);
    } catch (err: unknown) {
      if (isDirtyWorktreeError(err)) {
        const { confirmAction } = await confirmModule();
        const confirmed = await confirmAction(
          "You have uncommitted changes. Switching branches may overwrite them.\n\nSwitch anyway?",
          { kind: "warning" },
        );
        if (!confirmed) return;
        await action(true);
      } else {
        throw err;
      }
    }
  }, []);

  const switchBranch = useCallback(async (name: string) => {
    const { gitSwitchBranchCommand } = await gitClient();
    await withDirtyConfirmation((force) => gitSwitchBranchCommand(name, force));
    await afterBranchChange();
  }, [withDirtyConfirmation, afterBranchChange]);

  const createBranch = useCallback(async (name: string) => {
    const { gitCreateBranchCommand } = await gitClient();
    await withDirtyConfirmation((force) => gitCreateBranchCommand(name, force));
    await afterBranchChange();
  }, [withDirtyConfirmation, afterBranchChange]);

  return { currentBranch, refreshBranch, switchBranch, createBranch };
}
