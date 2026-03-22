import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { SidebarProvider } from "./components/sidebar";
import { AppMainShell } from "./components/app-main-shell";
import { AppOverlays } from "./components/app-overlays";
import { AppSidebarShell } from "./components/app-sidebar-shell";
import { useAppDebug } from "./hooks/use-app-debug";
import { useAppEditorShell } from "./hooks/use-app-editor-shell";
import { useAppOverlays } from "./hooks/use-app-overlays";
import { useAppSessionPersistence } from "./hooks/use-app-session-persistence";
import { useAppWorkspaceSession } from "./hooks/use-app-workspace-session";

// ── Inner app (has access to FileSystem context) ──────────────────────────────

function AppInner() {
  const fs = useFileSystem();
  const workspace = useAppWorkspaceSession(fs);
  const editor = useAppEditorShell({
    fs,
    settings: workspace.settings,
    refreshTree: workspace.refreshTree,
    addRecentFile: workspace.addRecentFile,
  });

  useAppSessionPersistence({
    fileTree: workspace.fileTree,
    workspace,
    editor,
  });

  const overlays = useAppOverlays({
    fs,
    workspace,
    editor,
  });

  useAppDebug({
    openFile: editor.openFile,
    saveFile: editor.saveFile,
    closeFile: () => {
      if (editor.activeTab) {
        void editor.closeFile(editor.activeTab);
      }
    },
    setMode: editor.handleModeChange,
    getMode: () => editor.editorMode,
  });

  return (
    <SidebarProvider
      open={!workspace.sidebarCollapsed}
      onOpenChange={(open) => workspace.setSidebarCollapsed(!open)}
      width={workspace.sidebarWidth}
      onWidthChange={workspace.setSidebarWidth}
    >
      <div
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
        <AppOverlays workspace={workspace} editor={editor} overlays={overlays} />
      </div>
    </SidebarProvider>
  );
}

// ── AppShell (public export) ──────────────────────────────────────────────────

interface AppShellProps {
  fs: FileSystem;
}

export function AppShell({ fs }: AppShellProps) {
  return (
    <FileSystemProvider value={fs}>
      <AppInner />
    </FileSystemProvider>
  );
}
