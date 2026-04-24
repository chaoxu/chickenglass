import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "../file-manager";
import { findDefaultDocumentPath } from "../default-document-path";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";
import type { SidebarLayoutController } from "./use-sidebar-layout";
import {
  createHotExitBackupStore,
  type HotExitBackupStore,
} from "../hot-exit-backups";

const SIDEBAR_WIDTH_SAVE_DEBOUNCE_MS = 200;

interface AppSessionPersistenceDeps {
  fileTree: FileEntry | null;
  /** When provided, default-doc search loads subdirectories lazily. */
  listChildren?: (path: string) => Promise<FileEntry[]>;
  /** Generation counter from the workspace session — incremented before
   *  each project-root change so async restore can detect stale searches. */
  workspaceRequestRef: { readonly current: number };
  workspace: Pick<
    AppWorkspaceSessionController,
    "projectRoot" | "windowState" | "saveWindowState" | "startupComplete"
  >;
  sidebarLayout: Pick<
    SidebarLayoutController,
    | "sidebarCollapsed"
    | "sidebarTab"
    | "sidebarWidth"
    | "sidenotesCollapsed"
    | "setSidebarCollapsed"
    | "setSidebarTab"
    | "setSidebarWidth"
    | "setSidenotesCollapsed"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentDocument" | "currentPath" | "openFile" | "restoreDocumentFromRecovery"
  >;
  hotExitBackupStore?: HotExitBackupStore | null;
}

type SessionRestoreState =
  | { status: "waiting-startup" }
  | {
    status: "restore-ui";
    generation: number;
    savedDocumentPath: string | null;
    savedLayout: AppSessionPersistenceDeps["workspace"]["windowState"]["layout"];
  }
  | {
    status: "restore-document";
    generation: number;
    savedDocumentPath: string | null;
  }
  | { status: "completed" };

export function useAppSessionPersistence({
  fileTree,
  listChildren,
  workspaceRequestRef,
  workspace,
  sidebarLayout,
  editor,
  hotExitBackupStore,
}: AppSessionPersistenceDeps): void {
  const [restoreState, setRestoreState] = useState<SessionRestoreState>({
    status: "waiting-startup",
  });
  const {
    projectRoot,
    windowState,
    saveWindowState,
    startupComplete,
  } = workspace;
  const {
    sidebarCollapsed,
    sidebarTab,
    sidebarWidth,
    sidenotesCollapsed,
    setSidebarCollapsed,
    setSidebarTab,
    setSidebarWidth,
    setSidenotesCollapsed,
  } = sidebarLayout;
  const {
    currentDocument,
    currentPath,
    openFile,
    restoreDocumentFromRecovery,
  } = editor;
  const defaultHotExitBackupStore = useMemo(() => createHotExitBackupStore(), []);
  const recoveryStore = hotExitBackupStore === undefined
    ? defaultHotExitBackupStore
    : hotExitBackupStore;

  useEffect(() => {
    if (restoreState.status !== "completed") return;
    saveWindowState({
      currentDocument: currentDocument
        ? { path: currentDocument.path, name: currentDocument.name }
        : null,
    });
  }, [currentDocument, currentPath, restoreState.status, saveWindowState]);

  useEffect(() => {
    if (restoreState.status !== "completed") return;
    const timeout = window.setTimeout(() => {
      saveWindowState({
        layout: {
          sidebarCollapsed,
          sidebarTab,
          sidebarWidth,
          sidenotesCollapsed,
        },
      });
    }, SIDEBAR_WIDTH_SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    restoreState.status,
    saveWindowState,
    sidebarCollapsed,
    sidebarTab,
    sidebarWidth,
    sidenotesCollapsed,
  ]);

  useEffect(() => {
    if (restoreState.status !== "waiting-startup" || !startupComplete) {
      return;
    }

    setRestoreState({
      status: "restore-ui",
      generation: workspaceRequestRef.current,
      savedDocumentPath: windowState.currentDocument?.path ?? null,
      savedLayout: windowState.layout,
    });
  }, [
    restoreState.status,
    startupComplete,
    windowState.currentDocument,
    windowState.layout,
    workspaceRequestRef,
  ]);

  useEffect(() => {
    if (restoreState.status !== "restore-ui") {
      return;
    }

    setSidebarCollapsed(restoreState.savedLayout.sidebarCollapsed);
    setSidebarTab(restoreState.savedLayout.sidebarTab);
    setSidenotesCollapsed(restoreState.savedLayout.sidenotesCollapsed);
    setSidebarWidth(restoreState.savedLayout.sidebarWidth);

    setRestoreState({
      status: "restore-document",
      generation: restoreState.generation,
      savedDocumentPath: restoreState.savedDocumentPath,
    });
  }, [
    restoreState,
    setSidebarCollapsed,
    setSidebarTab,
    setSidebarWidth,
    setSidenotesCollapsed,
  ]);

  useEffect(() => {
    if (restoreState.status !== "restore-document") {
      return;
    }

    const { generation, savedDocumentPath } = restoreState;
    const controller = new AbortController();
    let cancelled = false;

    const guardedListChildren = listChildren
      ? async (path: string): Promise<FileEntry[]> => {
          if (cancelled || workspaceRequestRef.current !== generation) {
            controller.abort();
            return [];
          }
          const result = await listChildren(path);
          if (cancelled || workspaceRequestRef.current !== generation) {
            controller.abort();
            return [];
          }
          return result;
        }
      : undefined;

    void (async () => {
      try {
        if (!fileTree) {
          return;
        }

        if (recoveryStore && projectRoot) {
          try {
            const summaries = await recoveryStore.listBackups(projectRoot);
            if (cancelled || workspaceRequestRef.current !== generation) {
              return;
            }
            const recoverySummary = (savedDocumentPath
              ? summaries.find((summary) => summary.path === savedDocumentPath)
              : undefined) ?? summaries[0];
            if (recoverySummary) {
              const shouldRestore = window.confirm(
                `Recover unsaved changes for "${recoverySummary.name}"?`,
              );
              if (shouldRestore) {
                const backup = await recoveryStore.readBackup(projectRoot, recoverySummary.path);
                if (cancelled || workspaceRequestRef.current !== generation) {
                return;
              }
              if (backup) {
                await restoreDocumentFromRecovery(backup.path, backup.content, {
                  baselineHash: backup.baselineHash,
                });
                return;
              }
            }
            }
          } catch (error: unknown) {
            console.error("[session] failed to restore hot-exit backup:", error);
          }
        }

        if (savedDocumentPath) {
          try {
            await openFile(savedDocumentPath);
            return;
          } catch (_error: unknown) {
            // File may have been deleted or may not exist under the restored root.
          }
        }

        const first = await findDefaultDocumentPath(
          fileTree,
          guardedListChildren,
          controller.signal,
        );
        if (cancelled || workspaceRequestRef.current !== generation) {
          return;
        }
        if (first) {
          try {
            await openFile(first);
          } catch (_error: unknown) {
            // Default file may have disappeared between tree load and open.
          }
        }
      } finally {
        if (!cancelled) {
          setRestoreState({ status: "completed" });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    fileTree,
    listChildren,
    openFile,
    projectRoot,
    recoveryStore,
    restoreDocumentFromRecovery,
    restoreState,
    workspaceRequestRef,
  ]);
}
