import { lazy, Suspense, useCallback, useMemo, useRef } from "react";
import { AppMainShell } from "./components/app-main-shell";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { ErrorBoundary } from "./components/error-boundary";
import { SidebarProvider } from "./components/sidebar";
import {
  AppEditorControllerProvider,
  useAppEditorController,
} from "./contexts/app-editor-context";
import {
  AppWorkspaceControllerProvider,
  useAppWorkspaceController,
} from "./contexts/app-workspace-context";
import {
  AppSidebarDiagnosticsProvider,
  AppSidebarFileTreeProvider,
  AppSidebarOutlineProvider,
} from "./contexts/app-sidebar-context";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileEntry, FileSystem, MemoryFileSystemEntry } from "./file-manager";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppFileDialogs } from "./hooks/use-app-file-dialogs";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useAppWorkspaceSession } from "./hooks/use-app-workspace-session";
import type {
  AutoSaveFlushOptions,
  AutoSaveFlushReason,
  UseAutoSaveReturn,
} from "./hooks/use-auto-save";
import { useDialogs } from "./hooks/use-dialogs";
import { useHotExitBackups } from "./hooks/use-hot-exit-backups";
import { createHotExitBackupStore } from "./hot-exit-backups";
import { useAppSaveLifecycle } from "./hooks/use-app-save-lifecycle";
import { useProjectFileWatcher } from "./hooks/use-project-file-watcher";
import {
  type SidebarLayoutController,
  type SidebarTab,
  useSidebarLayout,
} from "./hooks/use-sidebar-layout";
import { useUnsavedChangesDialog } from "./hooks/use-unsaved-changes-dialog";
import { useDevSettings } from "../state/dev-settings";
import type { DebugProjectFile } from "../debug/debug-bridge-contract.js";

interface FixtureProjectFileSystem extends FileSystem {
  replaceAll(entries: readonly MemoryFileSystemEntry[]): void;
}

function canLoadFixtureProject(fs: FileSystem): fs is FixtureProjectFileSystem {
  return typeof (fs as { replaceAll?: unknown }).replaceAll === "function";
}

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
  const perfPanelOpen = useDevSettings((state) => state.perfPanel);
  const overlays = useAppOverlays({
    fs,
    dialogs,
    workspace,
    sidebarLayout,
    editor,
    onOpenFile,
    onOpenFolder,
    onQuit,
  });
  const shouldLoadOverlays =
    dialogs.paletteOpen ||
    dialogs.searchOpen ||
    dialogs.settingsOpen ||
    dialogs.aboutOpen ||
    dialogs.shortcutsOpen ||
    dialogs.gotoLineOpen ||
    unsavedChanges.status === "pending" ||
    overlays.labelBacklinks !== null ||
    perfPanelOpen;

  if (!shouldLoadOverlays) {
    return null;
  }

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
  const dialogs = useDialogs();
  const unsavedChanges = useUnsavedChangesDialog();
  const workspace = useAppWorkspaceSession(fs);
  const sidebarLayout = useSidebarLayout();
  const hotExitBackupStore = useMemo(() => createHotExitBackupStore(), []);
  const autoSaveFlushRef = useRef<UseAutoSaveReturn["flushPendingAutoSave"] | null>(null);
  const deleteHotExitBackupRef = useRef<((path: string) => void) | null>(null);
  const flushHotExitBackupRef = useRef<(() => Promise<void>) | null>(null);
  const flushPendingAutoSave = useCallback(async (
    reason: AutoSaveFlushReason,
    options?: AutoSaveFlushOptions,
  ) => {
    await autoSaveFlushRef.current?.(reason, options);
  }, []);
  const deleteHotExitBackup = useCallback((path: string) => {
    deleteHotExitBackupRef.current?.(path);
  }, []);
  const flushPendingHotExitBackup = useCallback(async () => {
    await flushHotExitBackupRef.current?.();
  }, []);
  const handleAfterSave = useCallback(async (path: string) => {
    deleteHotExitBackup(path);
    await workspace.reloadProjectConfig(path);
  }, [deleteHotExitBackup, workspace.reloadProjectConfig]);

  const editor = useAppEditorShell({
    fs,
    settings: workspace.settings,
    refreshTree: workspace.refreshTree,
    addRecentFile: workspace.addRecentFile,
    onAfterSave: handleAfterSave,
    onAfterPathRemoved: deleteHotExitBackup,
    onAfterDiscard: deleteHotExitBackup,
    flushPendingHotExitBackup,
    flushPendingAutoSave,
    requestUnsavedChangesDecision: unsavedChanges.requestDecision,
  });
  const handleWatchedPathChange = useCallback((path: string) => {
    editor.handleWatchedPathChange(path);
    void workspace.reloadProjectConfig(path).catch((error: unknown) => {
      console.error("[workspace] project config reload after watched change failed", error);
    });
  }, [editor.handleWatchedPathChange, workspace.reloadProjectConfig]);

  const autoSave = useAppSaveLifecycle({
    activeDocumentSignal: editor.activeDocumentSignal,
    autoSaveInterval: workspace.settings.autoSaveInterval,
    autosaveSuspended:
      unsavedChanges.status === "pending"
      || editor.hasUnresolvedExternalConflict,
    currentPath: editor.currentPath,
    hasDirtyDocument: editor.hasDirtyDocument,
    handleWindowCloseRequest: editor.handleWindowCloseRequest,
    saveFile: editor.saveFile,
  });
  autoSaveFlushRef.current = autoSave.flushPendingAutoSave;

  const hotExitBackups = useHotExitBackups({
    activeDocumentSignal: editor.activeDocumentSignal,
    currentDocument: editor.currentDocument,
    getCurrentBaselineHash: editor.getCurrentBaselineHash,
    getCurrentDocText: editor.getCurrentDocText,
    hasDirtyDocument: editor.hasDirtyDocument,
    projectRoot: workspace.projectRoot,
    store: hotExitBackupStore,
  });
  deleteHotExitBackupRef.current = hotExitBackups.deleteBackup;
  flushHotExitBackupRef.current = hotExitBackups.flushBackup;

  // Stable reference for lazy child loading — used by default-doc search
  // and session persistence so their effects don't re-fire unnecessarily.
  const listChildrenStable = useMemo(() => {
    if (!fs.listChildren) {
      return undefined;
    }
    return (path: string) => fs.listChildren?.(path) as Promise<FileEntry[]>;
  }, [fs]);

  const loadFixtureProject = useMemo(() => {
    if (!canLoadFixtureProject(fs)) {
      return undefined;
    }

    return async (
      files: readonly DebugProjectFile[],
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
    hotExitBackupStore,
  });
  const sidebarShellLayout = useMemo(() => ({
    sidebarTab: sidebarLayout.sidebarTab,
    setSidebarTab: sidebarLayout.setSidebarTab,
  }), [sidebarLayout.sidebarTab, sidebarLayout.setSidebarTab]);
  const sidebarFileTreeController = useMemo(() => ({
    activePath: editor.currentPath,
    createDirectory: editor.createDirectory,
    createFile: editor.createFile,
    fileTree: workspace.fileTree,
    handleDelete: editor.handleDelete,
    handleRename: editor.handleRename,
    loadChildren: workspace.loadChildren,
    openFile: editor.openFile,
  }), [
    editor.createDirectory,
    editor.createFile,
    editor.currentPath,
    editor.handleDelete,
    editor.handleRename,
    editor.openFile,
    workspace.fileTree,
    workspace.loadChildren,
  ]);
  const sidebarOutlineController = useMemo(() => ({
    headings: editor.headings,
    onSelect: editor.handleOutlineSelect,
  }), [editor.handleOutlineSelect, editor.headings]);
  const sidebarDiagnosticsController = useMemo(() => ({
    diagnostics: editor.diagnostics,
    onSelect: editor.handleOutlineSelect,
  }), [editor.diagnostics, editor.handleOutlineSelect]);

  useAppSessionPersistence({
    fileTree: workspace.fileTree,
    listChildren: listChildrenStable,
    workspaceRequestRef: workspace.workspaceRequestRef,
    workspace,
    sidebarLayout,
    editor,
    hotExitBackupStore,
  });

  useProjectFileWatcher({
    projectRoot: workspace.projectRoot,
    refreshTree: workspace.refreshTree,
    handleWatchedPathChange,
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
    getCurrentDocText: editor.getCurrentDocText,
    getLexicalEditorHandle: editor.getLexicalEditorHandle,
    setSearchOpen: dialogs.setSearchOpen,
    showSidebarPanel: (panel: SidebarTab) => {
      sidebarLayout.setSidebarTab(panel);
      sidebarLayout.setSidebarCollapsed(false);
    },
    getSidebarState: () => ({
      collapsed: sidebarLayout.sidebarCollapsed,
      tab: sidebarLayout.sidebarTab,
    }),
    requestNativeClose: fileDialogs.handleQuitRequest,
    setMode: editor.handleModeChange,
    getMode: () => editor.editorMode,
    projectRoot: workspace.projectRoot,
    currentDocument: editor.currentDocument,
    hasDirtyDocument: editor.hasDirtyDocument,
    startupComplete: workspace.startupComplete,
    restoredProjectRoot: workspace.projectRoot,
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
          <AppSidebarFileTreeProvider value={sidebarFileTreeController}>
            <AppSidebarOutlineProvider value={sidebarOutlineController}>
              <AppSidebarDiagnosticsProvider value={sidebarDiagnosticsController}>
                <div
                  className="flex h-screen overflow-hidden overscroll-contain"
                  onDragOver={editor.handleDragOver}
                  onDrop={editor.handleDrop}
                >
                  <AppSidebarShell sidebarLayout={sidebarShellLayout} />
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
              </AppSidebarDiagnosticsProvider>
            </AppSidebarOutlineProvider>
          </AppSidebarFileTreeProvider>
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
