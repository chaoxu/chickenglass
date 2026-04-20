import { DebugSidebarProvider } from "./debug-sidebar";
import { EditorPane } from "./editor-pane";
import { StatusBar } from "./status-bar";
import { SidebarInset } from "./sidebar";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useAppPreferencesController } from "../contexts/app-preferences-context";
import type { SidebarLayoutController } from "../hooks/use-sidebar-layout";
import { isPluginEnabled } from "../plugin-manager";

interface AppMainShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidenotesCollapsed" | "setSidenotesCollapsed"
  >;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function AppMainShell({
  sidebarLayout: _sidebarLayout,
  onOpenPalette,
  onOpenSettings,
}: AppMainShellProps) {
  const preferences = useAppPreferencesController();
  const editor = useAppEditorController();
  const currentPath = editor.state.currentPath;

  return (
    <SidebarInset>
      <DebugSidebarProvider>
        {currentPath ? (
          <EditorPane
            doc={editor.state.editorDoc}
            docPath={currentPath}
            onDocChange={editor.surface.handleDocChange}
            onDirtyChange={editor.surface.handleDirtyChange}
            onHeadingsChange={editor.surface.handleHeadingsChange}
            onDocumentReady={editor.surface.handleEditorDocumentReady}
            onLexicalEditorReady={editor.surface.handleLexicalEditorReady}
            onOutlineSelect={editor.navigation.handleOutlineSelect}
            editorMode={editor.state.editorMode}
            spellCheck={isPluginEnabled(preferences.settings, "spellcheck")}
            revealPresentation={preferences.settings.revealPresentation}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center select-none text-sm text-[var(--cf-muted)]">
            Open a file to start editing
          </div>
        )}
      </DebugSidebarProvider>

      <StatusBar
        editorMode={editor.state.editorMode}
        onModeChange={editor.editing.handleModeChange}
        onOpenPalette={onOpenPalette}
        onOpenSettings={onOpenSettings}
        activeDocumentSignal={editor.state.activeDocumentSignal}
        getDocText={editor.queries.peekCurrentDocText}
        isMarkdown={editor.state.isMarkdownFile}
      />
    </SidebarInset>
  );
}
