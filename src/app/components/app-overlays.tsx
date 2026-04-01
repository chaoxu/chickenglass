import { AboutDialog } from "./about-dialog";
import { CommandPalette } from "./command-palette";
import { GotoLineDialog } from "./goto-line-dialog";
import { SearchPanel } from "./search-panel";
import { SettingsDialog } from "./settings-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";
import { PerfDebugPanel } from "./perf-debug-panel";
import type { UseDialogsReturn } from "../hooks/use-dialogs";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import { useEditorTelemetry } from "../stores/editor-telemetry-store";
import type { AppOverlayController } from "../hooks/use-app-overlays";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";
import type { UseUnsavedChangesDialogReturn } from "../hooks/use-unsaved-changes-dialog";
import { getAppSearchMode } from "../search";

interface AppOverlaysProps {
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "updateSetting" | "theme" | "setTheme"
  >;
  editor: Pick<
    AppEditorShellController,
    "handleSearchResult" | "pluginManager" | "handleGotoLine" | "editorMode"
  >;
  dialogs: UseDialogsReturn;
  overlays: AppOverlayController;
  unsavedChanges: UseUnsavedChangesDialogReturn;
}

export function AppOverlays({
  workspace,
  editor,
  dialogs,
  overlays,
  unsavedChanges,
}: AppOverlaysProps) {
  const currentLine = useEditorTelemetry((s) => s.cursorLine);

  return (
    <>
      <CommandPalette
        open={dialogs.paletteOpen}
        onOpenChange={dialogs.setPaletteOpen}
        commands={overlays.commands}
      />
      <SearchPanel
        open={dialogs.searchOpen}
        onOpenChange={dialogs.setSearchOpen}
        onResultSelect={(entry) => {
          editor.handleSearchResult({
            file: entry.file,
            pos: entry.position.from,
            editorMode: editor.editorMode,
          }, () => dialogs.setSearchOpen(false));
        }}
        searchMode={getAppSearchMode(editor.editorMode)}
        searchVersion={overlays.searchVersion}
        indexer={overlays.indexer}
      />
      <SettingsDialog
        open={dialogs.settingsOpen}
        onOpenChange={dialogs.setSettingsOpen}
        settings={workspace.settings}
        onUpdateSetting={workspace.updateSetting}
        theme={workspace.theme}
        onSetTheme={workspace.setTheme}
        plugins={editor.pluginManager.getPlugins()}
      />
      <AboutDialog open={dialogs.aboutOpen} onClose={dialogs.closeAbout} />
      <ShortcutsDialog
        open={dialogs.shortcutsOpen}
        onClose={dialogs.closeShortcuts}
      />
      <GotoLineDialog
        open={dialogs.gotoLineOpen}
        onOpenChange={dialogs.setGotoLineOpen}
        onGoto={(line, col) => {
          editor.handleGotoLine(line, col);
          dialogs.setGotoLineOpen(false);
        }}
        currentLine={currentLine}
      />
      <UnsavedChangesDialog
        request={unsavedChanges.request}
        onDecision={unsavedChanges.resolveDecision}
      />
      <PerfDebugPanel />
    </>
  );
}
