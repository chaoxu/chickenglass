import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
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
  sidebarLayout: _sidebarLayout,
  onOpenPalette,
}: AppMainShellProps) {
  const workspace = useAppWorkspaceController();
  const editor = useAppEditorController();
  const currentPath = editor.currentPath;

  return (
    <SidebarInset>
      {currentPath ? (
        <EditorPane
          doc={editor.editorDoc}
          docPath={currentPath}
          onDocChange={editor.handleDocChange}
          onHeadingsChange={editor.handleHeadingsChange}
          onDiagnosticsChange={editor.handleDiagnosticsChange}
          onDocumentReady={editor.handleEditorDocumentReady}
          onLexicalEditorReady={editor.handleLexicalEditorReady}
          onOutlineSelect={editor.handleOutlineSelect}
          editorMode={editor.editorMode}
          spellCheck={workspace.settings.enabledPlugins.spellcheck ?? workspace.settings.spellCheck}
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
