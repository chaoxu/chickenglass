import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { SidebarProvider } from "./components/sidebar";
import { AppMainShell } from "./components/app-main-shell";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { ErrorBoundary } from "./components/error-boundary";
import { useAppFileDialogs } from "./hooks/use-app-file-dialogs";
import { isTauri } from "../lib/tauri";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useDialogs } from "./hooks/use-dialogs";
import { useGitBranch } from "./hooks/use-git-branch";
import { useProjectFileWatcher } from "./hooks/use-project-file-watcher";
import { useWindowCloseGuard } from "./hooks/use-window-close-guard";
import { useAppWorkspaceSession } from "./hooks/use-app-workspace-session";
import { useGit } from "./hooks/use-git";
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
  const dialogs = useDialogs();
  const unsavedChanges = useUnsavedChangesDialog();
  const workspace = useAppWorkspaceSession(fs);
  const gitCommit = useGit(workspace.projectRoot);

  // Wrap refreshTree so every workspace mutation (save, rename, delete, create)
  // also refreshes git status. The editor session calls refreshTree after all
  // file-system mutations, so piggybacking here avoids threading git.refresh
  // through every hook in the chain.
  const refreshTreeAndGit = useCallback(async (changedPath?: string) => {
    await workspace.refreshTree(changedPath);
    void gitCommit.refresh();
  }, [workspace.refreshTree, gitCommit.refresh]);

  const editor = useAppEditorShell({
    fs,
    settings: workspace.settings,
    refreshTree: refreshTreeAndGit,
    refreshGitStatus: workspace.refreshGitStatus,
    addRecentFile: workspace.addRecentFile,
    onAfterSave: gitCommit.refresh,
    requestUnsavedChangesDecision: unsavedChanges.requestDecision,
  });

  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const gitBranch = useGitBranch({
    projectRoot: workspace.projectRoot,
    refreshTree: refreshTreeAndGit,
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

  const fileDialogs = useAppFileDialogs({
    editor,
    workspace,
    listChildren: listChildrenStable,
  });

  const git = useGitStatus(workspace.projectRoot, workspace.refreshTree);

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

  const isSelfChange = useCallback(async (path: string): Promise<boolean> => {
    try {
      const diskContent = await fs.readFile(path);
      return editor.pipeline.isSelfChange(path, diskContent);
    } catch {
      return false;
    }
  }, [editor.pipeline, fs]);

  useProjectFileWatcher({
    projectRoot: workspace.projectRoot,
    containerRef: appContainerRef,
    isPathOpen: editor.isPathOpen,
    isPathDirty: editor.isPathDirty,
    reloadFile: editor.reloadFile,
    isSelfChange,
  });

  const overlays = useAppOverlays({
    fs,
    dialogs,
    suspendAutoSave: unsavedChanges.request !== null,
    suspendAutoSaveRef: unsavedChanges.pendingRef,
    suspendAutoSaveVersionRef: unsavedChanges.suspensionVersionRef,
    workspace: {
      ...workspace,
      handleOpenFolder: fileDialogs.handleOpenFolderRequest,
    },
    editor,
    git,
    onOpenFile: fileDialogs.handleOpenFileRequest,
    onQuit: fileDialogs.handleQuitRequest,
  });

  useAppDebug({
    openProject: (path) => fileDialogs.openProjectInCurrentWindow(path),
    openFile: editor.openFile,
    saveFile: editor.saveFile,
    closeFile: () => {
      void editor.closeCurrentFile();
    },
    requestNativeClose: fileDialogs.handleQuitRequest,
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
        <AppSidebarShell workspace={workspace} editor={editor} git={isTauri() ? gitCommit : null} />
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
