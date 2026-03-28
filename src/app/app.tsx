import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { SidebarProvider } from "./components/sidebar";
import { AppMainShell } from "./components/app-main-shell";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { ErrorBoundary } from "./components/error-boundary";
import { isProjectRootEscapeError } from "./project-root-errors";
import { openProjectInCurrentWindow as openProjectInCurrentWindowFlow } from "./project-open";
import { dirname, basename } from "../lib/utils";
import { isTauri } from "../lib/tauri";
import { openDocumentInNewWindow } from "./window-launch";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useDialogs } from "./hooks/use-dialogs";
import { useGitBranch } from "./hooks/use-git-branch";
import { useProjectFileWatcher } from "./hooks/use-project-file-watcher";
import { useWindowCloseGuard } from "./hooks/use-window-close-guard";
import { useAppWorkspaceSession } from "./hooks/use-app-workspace-session";
import { useGitStatus } from "./hooks/use-git-status";
import { useUnsavedChangesDialog } from "./hooks/use-unsaved-changes-dialog";

/** Lazy-loaded overlay dialogs — not needed until the user opens one. */
const AppOverlays = lazy(() =>
  import("./components/app-overlays").then((m) => ({ default: m.AppOverlays })),
);
const BranchSwitcher = lazy(() =>
  import("./components/branch-switcher").then((m) => ({ default: m.BranchSwitcher })),
);

function AppInner() {
  const fs = useFileSystem();
  const appContainerRef = useRef<HTMLDivElement | null>(null);
  const openProjectRequestRef = useRef(0);
  const dialogs = useDialogs();
  const unsavedChanges = useUnsavedChangesDialog();
  const workspace = useAppWorkspaceSession(fs);
  const editor = useAppEditorShell({
    fs,
    settings: workspace.settings,
    refreshTree: workspace.refreshTree,
    addRecentFile: workspace.addRecentFile,
    requestUnsavedChangesDecision: unsavedChanges.requestDecision,
  });

  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const gitBranch = useGitBranch({
    projectRoot: workspace.projectRoot,
    refreshTree: workspace.refreshTree,
    reloadFile: editor.reloadFile,
    closeCurrentFile: editor.closeCurrentFile,
    currentPath: editor.currentPath,
    hasDirtyDocument: editor.hasDirtyDocument,
  });

  // Stable reference for lazy child loading — used by default-doc search
  // and session persistence so their effects don't re-fire unnecessarily.
  const listChildrenStable = useMemo(
    () => fs.listChildren ? (path: string) => fs.listChildren!(path) : undefined,
    [fs],
  );

  const openProjectInCurrentWindow = useCallback(async (
    projectRoot: string,
    initialPath?: string,
  ): Promise<boolean> => {
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
      listChildren: listChildrenStable,
    });
  }, [editor, workspace, listChildrenStable]);

  const git = useGitStatus(workspace.projectRoot, workspace.refreshTree);

  const handleOpenFolderRequest = useCallback(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { pickFolder } = await import("./tauri-fs");
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
          const { toProjectRelativePathCommand } = await import("./tauri-client/fs");
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

  useWindowCloseGuard({
    hasDirtyDocument: editor.hasDirtyDocument,
    handleWindowCloseRequest: editor.handleWindowCloseRequest,
  });

  useAppSessionPersistence({
    fileTree: workspace.fileTree,
    listChildren: listChildrenStable,
    workspaceRequestRef: workspace.workspaceRequestRef,
    workspace,
    editor,
  });

  useProjectFileWatcher({
    projectRoot: workspace.projectRoot,
    containerRef: appContainerRef,
    isPathOpen: editor.isPathOpen,
    isPathDirty: editor.isPathDirty,
    reloadFile: editor.reloadFile,
  });

  const overlays = useAppOverlays({
    fs,
    dialogs,
    suspendAutoSave: unsavedChanges.request !== null,
    suspendAutoSaveRef: unsavedChanges.pendingRef,
    suspendAutoSaveVersionRef: unsavedChanges.suspensionVersionRef,
    workspace: {
      ...workspace,
      handleOpenFolder: handleOpenFolderRequest,
    },
    editor,
    git,
    onOpenFile: handleOpenFileRequest,
    onQuit: handleQuitRequest,
  });

  useAppDebug({
    openProject: (path) => openProjectInCurrentWindow(path),
    openFile: editor.openFile,
    saveFile: editor.saveFile,
    closeFile: () => {
      void editor.closeCurrentFile();
    },
    requestNativeClose: handleQuitRequest,
    setMode: editor.handleModeChange,
    getMode: () => editor.editorMode,
    projectRoot: workspace.projectRoot,
    currentDocument: editor.currentDocument,
    hasDirtyDocument: editor.hasDirtyDocument,
    startupComplete: workspace.startupComplete,
    restoredProjectRoot: workspace.windowState.projectRoot,
  });

  return (
    <SidebarProvider
      open={!workspace.sidebarCollapsed}
      onOpenChange={(open) => workspace.setSidebarCollapsed(!open)}
      width={workspace.sidebarWidth}
      onWidthChange={workspace.setSidebarWidth}
    >
      <div
        ref={appContainerRef}
        className="flex h-screen overflow-hidden overscroll-contain"
        onDragOver={editor.handleDragOver}
        onDrop={editor.handleDrop}
      >
        <AppSidebarShell workspace={workspace} editor={editor} />
        <AppMainShell
          fs={fs}
          projectConfig={workspace.projectConfig}
          resolvedTheme={workspace.resolvedTheme}
          workspace={workspace}
          editor={editor}
          git={git}
          onOpenPalette={overlays.openPalette}
          branchName={gitBranch.currentBranch}
          onBranchClick={() => setBranchSwitcherOpen(true)}
        />
        <Suspense fallback={null}>
          <AppOverlays
            workspace={workspace}
            editor={editor}
            dialogs={dialogs}
            overlays={overlays}
            unsavedChanges={unsavedChanges}
          />
          <BranchSwitcher
            open={branchSwitcherOpen}
            onOpenChange={setBranchSwitcherOpen}
            onSwitch={gitBranch.switchBranch}
            onCreate={gitBranch.createBranch}
          />
        </Suspense>
      </div>
    </SidebarProvider>
  );
}

interface AppShellProps {
  fs: FileSystem;
}

export function AppShell({ fs }: AppShellProps) {
  return (
    <ErrorBoundary>
      <FileSystemProvider value={fs}>
        <AppInner />
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
