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
import {
  AppPreferencesControllerProvider,
  useAppPreferencesController,
} from "./contexts/app-preferences-context";
import { MemoryFileSystem, type FileSystem } from "./file-manager";
import { SidebarProvider } from "./components/sidebar";
import { AppMainShell } from "./components/app-main-shell";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { ErrorBoundary } from "./components/error-boundary";
import { useAppFileDialogs } from "./hooks/use-app-file-dialogs";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppPreferences } from "./hooks/use-app-preferences";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useDialogs } from "./hooks/use-dialogs";
import { useProjectFileWatcher } from "./hooks/use-project-file-watcher";
import { useWindowCloseGuard } from "./hooks/use-window-close-guard";
import { useWindowState } from "./hooks/use-window-state";
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
  const preferences = useAppPreferencesController();
  const editor = useAppEditorController();
  const overlays = useAppOverlays({
    fs,
    dialogs,
    suspendAutoSave: unsavedChanges.request !== null,
    suspendAutoSaveRef: unsavedChanges.pendingRef,
    suspendAutoSaveVersionRef: unsavedChanges.suspensionVersionRef,
    workspace,
    preferences,
    sidebarLayout,
    editor,
    onOpenFile,
    onOpenFolder,
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
  const windowStateController = useWindowState();
  const workspace = useAppWorkspaceSession(fs, {
    restoredProjectRoot: windowStateController.windowState.projectRoot,
    saveWorkspaceWindowState: windowStateController.saveState,
  });
  const preferences = useAppPreferences({
    projectRoot: workspace.projectRoot,
    windowState: windowStateController.windowState,
    saveWindowState: windowStateController.saveState,
  });
  const sidebarLayout = useSidebarLayout();

  const editor = useAppEditorShell({
    fs,
    settings: preferences.settings,
    refreshTree: workspace.refreshTree,
    addRecentFile: preferences.addRecentFile,
    requestUnsavedChangesDecision: unsavedChanges.requestDecision,
  });

  // Stable reference for lazy child loading — used by default-doc search
  // and session persistence so their effects don't re-fire unnecessarily.
  const listChildrenStable = useMemo(() => {
    const listChildren = fs.listChildren;
    if (!listChildren) {
      return undefined;
    }
    return (path: string) => listChildren.call(fs, path);
  }, [fs]);

  const loadFixtureProject = useMemo(() => {
    if (!(fs instanceof MemoryFileSystem)) {
      return undefined;
    }

    return async (
      files: readonly import("./hooks/use-app-debug").DebugProjectFile[],
      initialPath?: string,
    ) => {
      await editor.files.closeCurrentFile({ discard: true });
      fs.replaceAll(files);
      await workspace.refreshTree();
      if (initialPath) {
        await editor.files.openFile(initialPath);
      }
    };
  }, [editor, fs, workspace]);

  const fileDialogs = useAppFileDialogs({
    editor,
    workspace,
    preferences,
    listChildren: listChildrenStable,
  });

  useWindowCloseGuard({
    hasDirtyDocument: editor.state.hasDirtyDocument,
    handleWindowCloseRequest: editor.files.handleWindowCloseRequest,
  });

  useAppSessionPersistence({
    fileTree: workspace.fileTree,
    listChildren: listChildrenStable,
    workspaceRequestRef: workspace.workspaceRequestRef,
    windowState: preferences.windowState,
    saveWindowState: preferences.saveWindowState,
    startupComplete: workspace.startupComplete,
    sidebarLayout,
    editor,
  });

  useProjectFileWatcher({
    projectRoot: workspace.projectRoot,
    containerRef: appContainerRef,
    refreshTree: workspace.refreshTree,
    reloadFile: editor.files.reloadFile,
    syncExternalChange: editor.files.syncExternalChange,
  });

  useAppDebug({
    editorHandle: editor.state.editorHandle,
    lexicalEditor: editor.state.lexicalEditor,
    openProject: (path) => fileDialogs.openProjectInCurrentWindow(path),
    openFile: editor.files.openFile,
    hasFile: (path) => fs.exists(path),
    openFileWithContent: editor.files.openFileWithContent,
    loadFixtureProject,
    saveFile: editor.files.saveFile,
    closeFile: (options) => editor.files.closeCurrentFile(options),
    setSearchOpen: (open) => {
      if (open) {
        editor.queries.getCurrentDocText();
      }
      dialogs.setSearchOpen(open);
    },
    requestNativeClose: fileDialogs.handleQuitRequest,
    setMode: editor.editing.handleModeChange,
    getMode: () => editor.state.editorMode,
    getCurrentDocText: editor.queries.getCurrentDocText,
    getCurrentSourceMap: editor.queries.getCurrentSourceMap,
    projectRoot: workspace.projectRoot,
    currentDocument: editor.state.currentDocument,
    hasDirtyDocument: editor.state.hasDirtyDocument,
    startupComplete: workspace.startupComplete,
    restoredProjectRoot: preferences.windowState.projectRoot,
  });

  return (
    <AppPreferencesControllerProvider value={preferences}>
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
            onDragOver={editor.imports.handleDragOver}
            onDrop={editor.imports.handleDrop}
          >
            <AppSidebarShell sidebarLayout={sidebarLayout} />
            <AppMainShell
              sidebarLayout={sidebarLayout}
              onOpenPalette={() => dialogs.setPaletteOpen(true)}
              onOpenSettings={() => dialogs.setSettingsOpen(true)}
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
    </AppPreferencesControllerProvider>
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
