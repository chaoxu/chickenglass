import { lazy, Suspense, useMemo, useRef } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import {
  AppEditorControllerProvider,
  useAppEditorController,
} from "./contexts/app-editor-context";
import {
  AppWorkspaceControllerProvider,
  useAppWorkspaceController,
} from "./contexts/app-workspace-context";
import { MemoryFileSystem, type FileSystem } from "./file-manager";
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
import { useSidebarLayout, type SidebarLayoutController } from "./hooks/use-sidebar-layout";
import { useUnsavedChangesDialog } from "./hooks/use-unsaved-changes-dialog";

/** Lazy-loaded overlay dialogs — not needed until the user opens one. */
const AppOverlays = lazy(() =>
  import("./components/app-overlays").then((m) => ({ default: m.AppOverlays })),
);

interface ConnectedAppOverlaysProps {
  dialogs: ReturnType<typeof useDialogs>;
  sidebarLayout: Pick<
    SidebarLayoutController,
    "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed"
  >;
  unsavedChanges: ReturnType<typeof useUnsavedChangesDialog>;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onQuit: () => void;
}

function ConnectedAppOverlays({
  dialogs,
  sidebarLayout,
  unsavedChanges,
  onOpenFile,
  onOpenFolder,
  onQuit,
}: ConnectedAppOverlaysProps) {
  const fs = useFileSystem();
  const workspace = useAppWorkspaceController();
  const editor = useAppEditorController();
  const overlays = useAppOverlays({
    fs,
    dialogs,
    suspendAutoSave: unsavedChanges.status === "pending",
    suspendAutoSaveVersion: unsavedChanges.suspensionVersion,
    workspace: {
      ...workspace,
      handleOpenFolder: onOpenFolder,
    },
    sidebarLayout,
    editor,
    onOpenFile,
    onQuit,
  });

  return (
    <Suspense fallback={null}>
      <AppOverlays
        dialogs={dialogs}
        overlays={overlays}
        unsavedChanges={unsavedChanges}
      />
    </Suspense>
  );
}

function AppInner() {
  const fs = useFileSystem();
  const appContainerRef = useRef<HTMLDivElement | null>(null);
  const dialogs = useDialogs();
  const unsavedChanges = useUnsavedChangesDialog();
  const workspace = useAppWorkspaceSession(fs);
  const sidebarLayout = useSidebarLayout();

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

  const loadFixtureProject = useMemo(() => {
    if (!(fs instanceof MemoryFileSystem)) {
      return undefined;
    }

    return async (
      files: readonly import("./hooks/use-app-debug").DebugProjectFile[],
      initialPath?: string,
    ) => {
      await editor.closeCurrentFile({ discard: true });
      fs.replaceAll(files);
      await workspace.refreshTree();
      if (initialPath) {
        await editor.openFile(initialPath);
      }
    };
  }, [editor, fs, workspace]);

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
    sidebarLayout,
    editor,
  });

  useProjectFileWatcher({
    projectRoot: workspace.projectRoot,
    containerRef: appContainerRef,
    refreshTree: workspace.refreshTree,
    reloadFile: editor.reloadFile,
    handleWatchedPathChange: editor.handleWatchedPathChange,
    syncExternalChange: editor.syncExternalChange,
  });

  useAppDebug({
    openProject: (path) => fileDialogs.openProjectInCurrentWindow(path),
    openFile: editor.openFile,
    hasFile: (path) => fs.exists(path),
    openFileWithContent: editor.openFileWithContent,
    loadFixtureProject,
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
    <AppWorkspaceControllerProvider value={workspace}>
      <AppEditorControllerProvider value={editor}>
        <SidebarProvider
          open={!sidebarLayout.sidebarCollapsed}
          onOpenChange={(open) => sidebarLayout.setSidebarCollapsed(!open)}
          width={sidebarLayout.sidebarWidth}
          onWidthChange={sidebarLayout.setSidebarWidth}
        >
          <div
            ref={appContainerRef}
            className="flex h-screen overflow-hidden overscroll-contain"
            onDragOver={editor.handleDragOver}
            onDrop={editor.handleDrop}
          >
            <AppSidebarShell sidebarLayout={sidebarLayout} />
            <AppMainShell
              sidebarLayout={sidebarLayout}
              onOpenPalette={() => dialogs.setPaletteOpen(true)}
            />
            <ConnectedAppOverlays
              dialogs={dialogs}
              sidebarLayout={sidebarLayout}
              unsavedChanges={unsavedChanges}
              onOpenFile={fileDialogs.handleOpenFileRequest}
              onOpenFolder={fileDialogs.handleOpenFolderRequest}
              onQuit={fileDialogs.handleQuitRequest}
            />
          </div>
        </SidebarProvider>
      </AppEditorControllerProvider>
    </AppWorkspaceControllerProvider>
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
