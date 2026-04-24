import { lazy, Suspense, useEffect } from "react";
import { DebugSidebarProvider } from "./debug-sidebar";
import { ExternalConflictBanner } from "./external-conflict-banner";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useFileSystem } from "../contexts/file-system-context";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import type { SidebarLayoutController } from "../hooks/use-sidebar-layout";
import { getEditorModeAdapter } from "../editor-mode-adapter";

const LexicalEditorPane = lazy(async () => {
  const bootstrap = await import("./lexical-editor-pane-bootstrap");
  bootstrap.ensureLexicalEditorPaneBootstrapped();
  const module = await import("./lexical-editor-pane");
  return {
    default: module.LexicalEditorPane,
  };
});

const EditorPane = lazy(() =>
  import("./editor-pane").then((module) => ({
    default: module.EditorPane,
  })),
);

interface AppMainShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidenotesCollapsed" | "setSidenotesCollapsed" | "sidebarCollapsed" | "sidebarTab"
  >;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

interface LexicalEditorPaneFallbackProps {
  onLexicalEditorReady: (handle: null) => void;
  onSurfaceReady: () => void;
}

function LexicalEditorPaneFallback({
  onLexicalEditorReady,
  onSurfaceReady,
}: LexicalEditorPaneFallbackProps) {
  useEffect(() => {
    onLexicalEditorReady(null);
    onSurfaceReady();
  }, [onLexicalEditorReady, onSurfaceReady]);

  return <div className="flex-1 bg-[var(--cf-bg)]" />;
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
        reloadFile={editor.reloadFile}
        closeCurrentFile={editor.closeCurrentFile}
      />
      <DebugSidebarProvider>
        {currentPath && modeAdapter.usesLexicalSurface ? (
          <Suspense
            fallback={
              <LexicalEditorPaneFallback
                onLexicalEditorReady={editor.handleLexicalEditorReady}
                onSurfaceReady={editor.handleLexicalSurfaceReady}
              />
            }
          >
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
              revealMode={modeAdapter.lexicalRevealMode}
            />
          </Suspense>
        ) : currentPath ? (
          <Suspense fallback={<div className="flex-1 bg-[var(--cf-bg)]" />}>
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
          </Suspense>
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
