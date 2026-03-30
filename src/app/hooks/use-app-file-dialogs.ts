/**
 * useAppFileDialogs — project/file opening orchestration extracted from AppInner.
 *
 * Groups the four callbacks that handle native file/folder dialogs and
 * project-switching so AppInner only needs to call the hook and pass
 * the returned handles downstream.
 */

import { useCallback, useRef } from "react";
import { openProjectInCurrentWindow as openProjectInCurrentWindowFlow } from "../project-open";
import { isProjectRootEscapeError } from "../project-root-errors";
import { openDocumentInNewWindow } from "../window-launch";
import { dirname, basename } from "../../lib/utils";
import { isTauri } from "../../lib/tauri";
import type { FileEntry } from "../file-manager";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

export interface AppFileDialogsDeps {
  editor: Pick<
    AppEditorShellController,
    "cancelPendingOpenFile" | "closeCurrentFile" | "openFile"
  >;
  workspace: Pick<
    AppWorkspaceSessionController,
    "projectRoot" | "openProjectRoot"
  >;
  /** Stable lazy-loader for subdirectories; passed through to default-doc search. */
  listChildren?: (path: string) => Promise<FileEntry[]>;
}

export interface AppFileDialogsReturn {
  openProjectInCurrentWindow: (projectRoot: string, initialPath?: string) => Promise<boolean>;
  handleOpenFolderRequest: () => void;
  handleOpenFileRequest: () => void;
  handleQuitRequest: () => Promise<void>;
}

export function useAppFileDialogs({
  editor,
  workspace,
  listChildren,
}: AppFileDialogsDeps): AppFileDialogsReturn {
  const openProjectRequestRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  const openProjectInCurrentWindow = useCallback(async (
    projectRoot: string,
    initialPath?: string,
  ): Promise<boolean> => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    return openProjectInCurrentWindowFlow({
      projectRoot,
      initialPath,
      currentProjectRoot: workspace.projectRoot,
      nextRequestId: () => ++openProjectRequestRef.current,
      isRequestCurrent: (requestId) => requestId === openProjectRequestRef.current,
      cancelPendingOpenFile: editor.cancelPendingOpenFile,
      closeCurrentFile: editor.closeCurrentFile,
      openProjectRoot: workspace.openProjectRoot,
      openFile: editor.openFile,
      listChildren,
      signal: controller.signal,
    });
  }, [editor, workspace, listChildren]);

  const handleOpenFolderRequest = useCallback(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { pickFolder } = await import("../tauri-fs");
        const folderPath = await pickFolder();
        if (!folderPath || folderPath === workspace.projectRoot) {
          return;
        }
        await openProjectInCurrentWindow(folderPath);
      } catch (e: unknown) {
        console.error("[app] open folder request failed", e);
      }
    })();
  }, [openProjectInCurrentWindow, workspace.projectRoot]);

  const handleOpenFileRequest = useCallback(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          directory: false,
          multiple: false,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!selected || Array.isArray(selected)) return;

        const projectRelativeTarget = basename(selected);
        if (!workspace.projectRoot) {
          await openProjectInCurrentWindow(dirname(selected), projectRelativeTarget);
          return;
        }

        let relativePath: string;
        try {
          const { toProjectRelativePathCommand } = await import("../tauri-client/fs");
          relativePath = await toProjectRelativePathCommand(selected);
        } catch (error: unknown) {
          if (!isProjectRootEscapeError(error)) {
            throw error;
          }
          await openDocumentInNewWindow(dirname(selected), projectRelativeTarget);
          return;
        }

        await editor.openFile(relativePath);
      } catch (e: unknown) {
        console.error("[app] open file request failed", e);
      }
    })();
  }, [editor, openProjectInCurrentWindow, workspace.projectRoot]);

  const handleQuitRequest = useCallback(async (): Promise<void> => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e: unknown) {
      console.error("[app] quit request failed", e);
    }
  }, []);

  return {
    openProjectInCurrentWindow,
    handleOpenFolderRequest,
    handleOpenFileRequest,
    handleQuitRequest,
  };
}
