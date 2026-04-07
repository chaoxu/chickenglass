import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useFileSystem } from "../contexts/file-system-context";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import type { SidebarLayoutController } from "../hooks/use-sidebar-layout";

interface AppMainShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidenotesCollapsed" | "setSidenotesCollapsed"
  >;
  onOpenPalette: () => void;
}

export function AppMainShell({
  sidebarLayout,
  onOpenPalette,
}: AppMainShellProps) {
  const fs = useFileSystem();
  const workspace = useAppWorkspaceController();
  const editor = useAppEditorController();
  const currentPath = editor.currentPath;

  return (
    <SidebarInset>
      {currentPath ? (
        <EditorPane
          doc={editor.editorDoc}
          docPath={currentPath}
          projectConfig={workspace.projectConfig}
          theme={workspace.resolvedTheme}
          fs={fs}
          pluginManager={editor.pluginManager}
          sidenotesCollapsed={sidebarLayout.sidenotesCollapsed}
          onSidenotesCollapsedChange={sidebarLayout.setSidenotesCollapsed}
          onDocChange={editor.handleDocChange}
          onProgrammaticDocChange={(doc) => {
            editor.handleProgrammaticDocChange(currentPath, doc);
          }}
          onSourceMapChange={(sourceMap) => {
            editor.setDocumentSourceMap(currentPath, sourceMap);
          }}
          onStateChange={editor.handleEditorStateChange}
          onHeadingsChange={editor.handleHeadingsChange}
          onDiagnosticsChange={editor.handleDiagnosticsChange}
          onDocumentReady={editor.handleEditorDocumentReady}
          editorMode={editor.editorMode}
          activeDocumentSignal={editor.activeDocumentSignal}
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
        activeDocumentSignal={editor.activeDocumentSignal}
        getDocText={editor.getCurrentDocText}
        isMarkdown={editor.isMarkdownFile}
      />
    </SidebarInset>
  );
}
