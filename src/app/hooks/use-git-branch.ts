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
  /** Switch to an existing branch. Prompts on dirty worktree or unsaved editor changes. */
  switchBranch: (name: string) => Promise<void>;
  /** Create and switch to a new branch. Prompts on dirty worktree or unsaved editor changes. */
  createBranch: (name: string) => Promise<void>;
}

export interface UseGitBranchOptions {
  projectRoot: string | null;
  refreshTree: () => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  /** Close the active document (used when the file no longer exists after a branch switch). */
  closeCurrentFile: () => Promise<boolean>;
  currentPath: string | null;
  /** Whether the editor has unsaved in-memory changes. */
  hasDirtyDocument: boolean;
}

export function useGitBranch({
  projectRoot,
  refreshTree,
  reloadFile,
  closeCurrentFile,
  currentPath,
  hasDirtyDocument,
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
        // File does not exist on the target branch — close it so the
        // editor does not show stale content from the previous branch.
        await closeCurrentFile();
      }
    }
  }, [refreshBranch, refreshTree, reloadFile, closeCurrentFile, currentPath]);

  /**
   * Guard: if the editor has unsaved in-memory changes, prompt the user
   * before proceeding. Returns false if the user cancelled.
   */
  const guardEditorDirty = useCallback(async (): Promise<boolean> => {
    if (!hasDirtyDocument) return true;
    const { confirmAction } = await confirmModule();
    return confirmAction(
      "You have unsaved changes that will be lost if you switch branches.\n\nSwitch anyway?",
      { kind: "warning" },
    );
  }, [hasDirtyDocument]);

  /**
   * Try an operation, and if the backend returns a DIRTY_WORKTREE error,
   * prompt the user for confirmation and retry with force=true.
   * Returns true if the action succeeded, false if cancelled.
   */
  const withDirtyConfirmation = useCallback(async (
    action: (force: boolean) => Promise<void>,
  ): Promise<boolean> => {
    const { isDirtyWorktreeError } = await gitClient();
    try {
      await action(false);
      return true;
    } catch (err: unknown) {
      if (isDirtyWorktreeError(err)) {
        const { confirmAction } = await confirmModule();
        const confirmed = await confirmAction(
          "You have uncommitted changes. Switching branches may overwrite them.\n\nSwitch anyway?",
          { kind: "warning" },
        );
        if (!confirmed) return false;
        await action(true);
        return true;
      }
      throw err;
    }
  }, []);

  const switchBranch = useCallback(async (name: string) => {
    if (!(await guardEditorDirty())) return;
    const { gitSwitchBranchCommand } = await gitClient();
    const switched = await withDirtyConfirmation(
      (force) => gitSwitchBranchCommand(name, force),
    );
    if (switched) await afterBranchChange();
  }, [guardEditorDirty, withDirtyConfirmation, afterBranchChange]);

  const createBranch = useCallback(async (name: string) => {
    if (!(await guardEditorDirty())) return;
    const { gitCreateBranchCommand } = await gitClient();
    const switched = await withDirtyConfirmation(
      (force) => gitCreateBranchCommand(name, force),
    );
    if (switched) await afterBranchChange();
  }, [guardEditorDirty, withDirtyConfirmation, afterBranchChange]);

  return { currentBranch, refreshBranch, switchBranch, createBranch };
}
