import { DebugSidebarProvider } from "./debug-sidebar";
import { EditorPane } from "./editor-pane";
import { ExternalConflictBanner } from "./external-conflict-banner";
import { LexicalEditorPane } from "./lexical-editor-pane";
import { ensureLexicalEditorPaneBootstrapped } from "./lexical-editor-pane-bootstrap";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useFileSystem } from "../contexts/file-system-context";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import type { SidebarLayoutController } from "../hooks/use-sidebar-layout";
import { getEditorModeAdapter } from "../editor-mode-adapter";

ensureLexicalEditorPaneBootstrapped();

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
  const modeAdapter = getEditorModeAdapter(editor.editorMode, editor.isMarkdownFile);
  const saveStatus = !editor.currentDocument
    ? "idle"
    : editor.hasUnresolvedExternalConflict
    ? "conflict"
    : editor.saveActivity.status === "failed"
      ? "failed"
      : editor.saveActivity.status === "saving"
        ? "saving"
    : editor.currentDocument?.dirty
      ? "unsaved"
      : "saved";

  return (
    <SidebarInset>
      <ExternalConflictBanner
        conflict={editor.externalConflict}
        currentPath={currentPath}
        keepExternalConflict={editor.keepExternalConflict}
        mergeExternalConflict={editor.mergeExternalConflict}
        reloadFile={editor.reloadFile}
        closeCurrentFile={editor.closeCurrentFile}
      />
      <DebugSidebarProvider>
        {currentPath && modeAdapter.usesLexicalSurface ? (
          <LexicalEditorPane
            doc={editor.editorDoc}
            docPath={currentPath}
            projectConfig={workspace.projectConfig}
            projectConfigStatus={workspace.projectConfigStatus}
            fs={fs}
            onDocChange={editor.handleDocChange}
            onDirtyChange={editor.handleDirtyChange}
            onHeadingsChange={trackOutline ? editor.handleHeadingsChange : undefined}
            onDiagnosticsChange={trackDiagnostics ? editor.handleDiagnosticsChange : undefined}
            onLexicalEditorReady={editor.handleLexicalEditorReady}
            onSurfaceReady={editor.handleLexicalSurfaceReady}
            revealMode={modeAdapter.lexicalRevealMode}
          />
        ) : currentPath ? (
          <EditorPane
            doc={editor.editorDoc}
            docPath={currentPath}
            projectConfig={workspace.projectConfig}
            projectConfigStatus={workspace.projectConfigStatus}
            theme={workspace.resolvedTheme}
            fs={fs}
            settings={workspace.settings}
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
            editorMode={modeAdapter.cm6Mode}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center select-none text-sm text-[var(--cf-muted)]">
            Open a file to start editing
          </div>
        )}
      </DebugSidebarProvider>

      <StatusBar
        editorMode={editor.editorMode}
        saveStatus={saveStatus}
        saveStatusMessage={editor.saveActivity.message}
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
