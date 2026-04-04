import { lazy, Suspense, useCallback, useMemo, useRef } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { SidebarProvider } from "./components/sidebar";
import { AppMainShell } from "./components/app-main-shell";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { ErrorBoundary } from "./components/error-boundary";
import { useAppFileDialogs } from "./hooks/use-app-file-dialogs";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useDialogs } from "./hooks/use-dialogs";
import { useProjectFileWatcher } from "./hooks/use-project-file-watcher";
import { useWindowCloseGuard } from "./hooks/use-window-close-guard";
import { useAppWorkspaceSession } from "./hooks/use-app-workspace-session";
import { useUnsavedChangesDialog } from "./hooks/use-unsaved-changes-dialog";

/** Lazy-loaded overlay dialogs — not needed until the user opens one. */
const AppOverlays = lazy(() =>
  import("./components/app-overlays").then((m) => ({ default: m.AppOverlays })),
);

function AppInner() {
  const fs = useFileSystem();
  const appContainerRef = useRef<HTMLDivElement | null>(null);
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
    refreshTree: workspace.refreshTree,
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
    onOpenFile: fileDialogs.handleOpenFileRequest,
    onQuit: fileDialogs.handleQuitRequest,
  });

  useAppDebug({
    openProject: (path) => fileDialogs.openProjectInCurrentWindow(path),
    openFile: editor.openFile,
    saveFile: editor.saveFile,
    closeFile: (options) => editor.closeCurrentFile(options),
    setSearchOpen: dialogs.setSearchOpen,
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
        <AppSidebarShell workspace={workspace} editor={editor} />
        <AppMainShell
          fs={fs}
          projectConfig={workspace.projectConfig}
          resolvedTheme={workspace.resolvedTheme}
          workspace={workspace}
          editor={editor}
          onOpenPalette={overlays.openPalette}
        />
        <Suspense fallback={null}>
          <AppOverlays
            workspace={workspace}
            editor={editor}
            dialogs={dialogs}
            overlays={overlays}
            unsavedChanges={unsavedChanges}
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
