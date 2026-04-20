import { AboutDialog } from "./about-dialog";
import { CommandPalette } from "./command-palette";
import { DocumentLabelBacklinksDialog } from "./document-label-backlinks-dialog";
import { GotoLineDialog } from "./goto-line-dialog";
import { SearchPanel } from "./search-panel";
import { SettingsDialog } from "./settings-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useAppPreferencesController } from "../contexts/app-preferences-context";
import type { UseDialogsReturn } from "../hooks/use-dialogs";
import { useEditorTelemetry } from "../../state/editor-telemetry-store";
import type { AppOverlayController } from "../hooks/use-app-overlays";
import type { UseUnsavedChangesDialogReturn } from "../hooks/use-unsaved-changes-dialog";
import { getAppSearchMode } from "../search";

interface AppOverlaysProps {
  dialogs: UseDialogsReturn;
  overlays: AppOverlayController;
  unsavedChanges: UseUnsavedChangesDialogReturn;
}

export function AppOverlays({
  dialogs,
  overlays,
  unsavedChanges,
}: AppOverlaysProps) {
  const preferences = useAppPreferencesController();
  const editor = useAppEditorController();
  const currentLine = useEditorTelemetry((s) => s.cursorLine);

  return (
    <>
      <CommandPalette
        open={dialogs.paletteOpen}
        onOpenChange={dialogs.setPaletteOpen}
        commands={overlays.commands}
      />
      <DocumentLabelBacklinksDialog
        result={overlays.labelBacklinks}
        onOpenChange={(open) => {
          if (!open) {
            overlays.closeLabelBacklinks();
          }
        }}
        onSelect={(item) => {
          editor.navigation.handleOutlineSelect(item.from);
          overlays.closeLabelBacklinks();
        }}
      />
      <SearchPanel
        open={dialogs.searchOpen}
        onOpenChange={dialogs.setSearchOpen}
        onResultSelect={(entry) => {
          editor.navigation.handleSearchResult({
            file: entry.file,
            pos: entry.position.from,
            editorMode: editor.state.editorMode,
          }, () => dialogs.setSearchOpen(false));
        }}
        searchMode={getAppSearchMode(editor.state.editorMode)}
        searchVersion={overlays.searchVersion}
        indexer={overlays.indexer}
      />
      <SettingsDialog
        open={dialogs.settingsOpen}
        onOpenChange={dialogs.setSettingsOpen}
        settings={preferences.settings}
        onUpdateSetting={preferences.updateSetting}
        theme={preferences.theme}
        onSetTheme={preferences.setTheme}
        plugins={editor.plugins.manager.getPlugins()}
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
          editor.navigation.handleGotoLine(line, col);
          dialogs.setGotoLineOpen(false);
        }}
        currentLine={currentLine}
      />
      <UnsavedChangesDialog
        request={unsavedChanges.request}
        onDecision={unsavedChanges.resolveDecision}
      />
    </>
  );
}
