import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { TabBar } from "./tab-bar";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";
import type { FileSystem } from "../file-manager";

interface AppMainShellProps {
  fs: FileSystem;
  projectConfig: AppWorkspaceSessionController["projectConfig"];
  resolvedTheme: AppWorkspaceSessionController["resolvedTheme"];
  workspace: Pick<
    AppWorkspaceSessionController,
    "sidenotesCollapsed" | "setSidenotesCollapsed"
  >;
  editor: Pick<
    AppEditorShellController,
    "openTabs" | "reorderTabs" | "activeTab" | "switchToTab" | "closeFile" | "pinTab" | "editorDoc" | "pluginManager" | "handleDocChange" | "handleEditorStateChange" | "editorMode" | "handleModeChange" | "docTextForStats" | "isMarkdownFile"
  >;
  onOpenPalette: () => void;
}

export function AppMainShell({
  fs,
  projectConfig,
  resolvedTheme,
  workspace,
  editor,
  onOpenPalette,
}: AppMainShellProps) {
  return (
    <SidebarInset>
      <TabBar
        tabs={editor.openTabs}
        activeTab={editor.activeTab}
        onSelect={editor.switchToTab}
        onClose={editor.closeFile}
        onReorder={editor.reorderTabs}
        onPin={editor.pinTab}
      />

      {editor.activeTab ? (
        <EditorPane
          key={editor.activeTab}
          doc={editor.editorDoc}
          docPath={editor.activeTab}
          projectConfig={projectConfig}
          theme={resolvedTheme}
          fs={fs}
          pluginManager={editor.pluginManager}
          sidenotesCollapsed={workspace.sidenotesCollapsed}
          onSidenotesCollapsedChange={workspace.setSidenotesCollapsed}
          onDocChange={editor.handleDocChange}
          onStateChange={editor.handleEditorStateChange}
          editorMode={editor.editorMode}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center select-none text-sm text-[var(--cf-muted)]">
          Open a file to start editing
        </div>
      )}

      <StatusBar
        editorMode={editor.editorMode}
        onModeChange={editor.handleModeChange}
        onOpenPalette={onOpenPalette}
        docText={editor.docTextForStats}
        isMarkdown={editor.isMarkdownFile}
      />
    </SidebarInset>
  );
}
