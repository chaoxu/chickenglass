import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";
import type { GitStatus } from "../hooks/use-git-status";
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
    "currentPath" | "editorDoc" | "pluginManager" | "handleDocChange" | "handleProgrammaticDocChange" | "setDocumentSourceMap" | "handleEditorStateChange" | "handleEditorDocumentReady" | "editorMode" | "handleModeChange" | "docTextForStats" | "isMarkdownFile"
  >;
  git: Pick<GitStatus, "branch" | "ahead" | "behind" | "isPulling" | "isPushing">;
  onOpenPalette: () => void;
  branchName?: string | null;
  onBranchClick?: () => void;
}

export function AppMainShell({
  fs,
  projectConfig,
  resolvedTheme,
  workspace,
  editor,
  git,
  onOpenPalette,
  branchName,
  onBranchClick,
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
        branchName={branchName}
        onBranchClick={onBranchClick}
        gitAhead={git.ahead}
        gitBehind={git.behind}
        gitIsBusy={git.isPulling || git.isPushing}
      />
    </SidebarInset>
  );
}
