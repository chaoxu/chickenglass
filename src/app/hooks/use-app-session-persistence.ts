import { useEffect, useRef } from "react";
import type { FileEntry } from "../file-manager";
import { findDefaultDocumentPath, findDefaultDocumentPathLazy } from "../default-document-path";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

interface AppSessionPersistenceDeps {
  fileTree: FileEntry | null;
  /** When provided, default-doc search loads subdirectories lazily. */
  listChildren?: (path: string) => Promise<FileEntry[]>;
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
  listChildren,
  workspace,
  editor,
}: AppSessionPersistenceDeps): void {
  const didInitRef = useRef(false);
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  // Tracks the current fileTree so the async restore can detect a
  // project-switch that happened while findDefaultDocumentPathLazy was
  // in flight (the lazy search reads against the backend root, which
  // changes when a new project is opened).
  const fileTreeRef = useRef(fileTree);
  fileTreeRef.current = fileTree;
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

        const first = listChildren
          ? await findDefaultDocumentPathLazy(fileTree, listChildren)
          : findDefaultDocumentPath(fileTree);
        // Abort if the project changed during the lazy search — the
        // returned path may belong to the new project's namespace.
        if (fileTreeRef.current !== fileTree) return;
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
    listChildren,
    openFile,
    setSidebarCollapsed,
    setSidebarWidth,
    startupComplete,
    windowState.currentDocument,
    windowState.sidebarWidth,
  ]);
}
