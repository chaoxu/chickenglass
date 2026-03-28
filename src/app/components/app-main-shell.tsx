import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";
import type { FileSystem } from "../file-manager";

interface AppMainShellProps {
  fs: FileSystem;
  projectConfig: AppWorkspaceSessionController["projectConfig"];
  resolvedTheme: AppWorkspaceSessionController["resolvedTheme"];
  workspace: Pick<
    AppWorkspaceSessionController,
    "sidenotesCollapsed" | "setSidenotesCollapsed" | "gitBranch"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentPath" | "editorDoc" | "pluginManager" | "handleDocChange" | "handleProgrammaticDocChange" | "setDocumentSourceMap" | "handleEditorStateChange" | "handleEditorDocumentReady" | "editorMode" | "handleModeChange" | "docTextForStats" | "isMarkdownFile"
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
  const currentPath = editor.currentPath;

  return (
    <SidebarInset>
      {currentPath ? (
        <EditorPane
          doc={editor.editorDoc}
          docPath={currentPath}
          projectConfig={projectConfig}
          theme={resolvedTheme}
          fs={fs}
          pluginManager={editor.pluginManager}
          sidenotesCollapsed={workspace.sidenotesCollapsed}
          onSidenotesCollapsedChange={workspace.setSidenotesCollapsed}
          onDocChange={editor.handleDocChange}
          onProgrammaticDocChange={(doc) => {
            editor.handleProgrammaticDocChange(currentPath, doc);
          }}
          onSourceMapChange={(sourceMap) => {
            editor.setDocumentSourceMap(currentPath, sourceMap);
          }}
          onStateChange={editor.handleEditorStateChange}
          onDocumentReady={editor.handleEditorDocumentReady}
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
        gitBranch={workspace.gitBranch}
      />
    </SidebarInset>
  );
}
