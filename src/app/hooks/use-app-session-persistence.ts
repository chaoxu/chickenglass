import { useEffect, useRef } from "react";
import type { FileEntry } from "../file-manager";
import { findDefaultDocumentPath } from "../default-document-path";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

interface AppSessionPersistenceDeps {
  fileTree: FileEntry | null;
  workspace: Pick<
    AppWorkspaceSessionController,
    "windowState" | "saveWindowState" | "sidebarCollapsed" | "sidebarWidth" | "setSidebarCollapsed" | "setSidebarWidth" | "startupComplete"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentDocument" | "currentPath" | "openFile"
  >;
}

export function useAppSessionPersistence({
  fileTree,
  workspace,
  editor,
}: AppSessionPersistenceDeps): void {
  const didInitRef = useRef(false);
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  const {
    windowState,
    saveWindowState,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    startupComplete,
  } = workspace;
  const {
    currentDocument,
    currentPath,
    openFile,
  } = editor;

  useEffect(() => {
    if (!didInitRef.current) return;
    saveWindowState({
      currentDocument: currentDocument
        ? { path: currentDocument.path, name: currentDocument.name }
        : null,
    });
  }, [currentDocument, currentPath, saveWindowState]);

  useEffect(() => {
    if (!didInitRef.current) return;
    saveWindowState({
      sidebarWidth: sidebarCollapsed ? 0 : sidebarWidth,
    });
  }, [saveWindowState, sidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (didInitRef.current || restorePromiseRef.current || !startupComplete) return;

    const restore = async () => {
      try {
        if (windowState.sidebarWidth === 0) {
          setSidebarCollapsed(true);
        } else if (windowState.sidebarWidth > 0) {
          setSidebarWidth(windowState.sidebarWidth);
        }

        if (!fileTree) {
          return;
        }

        if (windowState.currentDocument) {
          try {
            await openFile(windowState.currentDocument.path);
            return;
          } catch {
            // File may have been deleted or may not exist under the restored root.
          }
        }

        const first = findDefaultDocumentPath(fileTree);
        if (first) {
          await openFile(first).catch(() => {
            // Default file may have disappeared between tree load and open.
          });
        }
      } finally {
        didInitRef.current = true;
      }
    };

    restorePromiseRef.current = restore().finally(() => {
      restorePromiseRef.current = null;
    });
  }, [
    fileTree,
    openFile,
    setSidebarCollapsed,
    setSidebarWidth,
    startupComplete,
    windowState.currentDocument,
    windowState.sidebarWidth,
  ]);
}
