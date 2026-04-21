import { DebugSidebarProvider } from "./debug-sidebar";
import { EditorPane } from "./editor-pane";
import { LexicalEditorPane } from "./lexical-editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useFileSystem } from "../contexts/file-system-context";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import type { SidebarLayoutController } from "../hooks/use-sidebar-layout";
import { isLexicalEditorMode } from "../../editor-display-mode";

interface AppMainShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidenotesCollapsed" | "setSidenotesCollapsed" | "sidebarCollapsed" | "sidebarTab"
  >;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function AppMainShell({
  sidebarLayout,
  onOpenPalette,
  onOpenSettings,
}: AppMainShellProps) {
  const fs = useFileSystem();
  const workspace = useAppWorkspaceController();
  const editor = useAppEditorController();
  const currentPath = editor.currentPath;
  const trackOutline = !sidebarLayout.sidebarCollapsed && sidebarLayout.sidebarTab === "outline";
  const trackDiagnostics = !sidebarLayout.sidebarCollapsed && sidebarLayout.sidebarTab === "diagnostics";
  const useLexicalEditor = isLexicalEditorMode(editor.editorMode);
  const cm6EditorMode = editor.editorMode === "source" ? "source" : "rich";

  return (
    <SidebarInset>
      <DebugSidebarProvider>
        {currentPath && useLexicalEditor ? (
          <LexicalEditorPane
            doc={editor.editorDoc}
            docPath={currentPath}
            projectConfig={workspace.projectConfig}
            theme={workspace.resolvedTheme}
            fs={fs}
            sidenotesCollapsed={sidebarLayout.sidenotesCollapsed}
            onSidenotesCollapsedChange={sidebarLayout.setSidenotesCollapsed}
            onDocChange={editor.handleDocChange}
            onDirtyChange={editor.handleDirtyChange}
            onProgrammaticDocChange={(doc) => {
              editor.handleProgrammaticDocChange(currentPath, doc);
            }}
            onHeadingsChange={trackOutline ? editor.handleHeadingsChange : undefined}
            onDiagnosticsChange={trackDiagnostics ? editor.handleDiagnosticsChange : undefined}
            onLexicalEditorReady={editor.handleLexicalEditorReady}
            onSurfaceReady={editor.handleLexicalSurfaceReady}
            editorMode={editor.editorMode}
          />
        ) : currentPath ? (
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
            onStateChange={editor.handleEditorStateChange}
            onHeadingsChange={trackOutline ? editor.handleHeadingsChange : undefined}
            onDiagnosticsChange={trackDiagnostics ? editor.handleDiagnosticsChange : undefined}
            onDocumentReady={editor.handleEditorDocumentReady}
            editorMode={cm6EditorMode}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center select-none text-sm text-[var(--cf-muted)]">
            Open a file to start editing
          </div>
        )}
      </DebugSidebarProvider>

      <StatusBar
        editorMode={editor.editorMode}
        onModeChange={editor.handleModeChange}
        onOpenPalette={onOpenPalette}
        onOpenSettings={onOpenSettings}
        activeDocumentSignal={editor.activeDocumentSignal}
        getDocText={editor.getCurrentDocText}
        isMarkdown={editor.isMarkdownFile}
      />
    </SidebarInset>
  );
}
