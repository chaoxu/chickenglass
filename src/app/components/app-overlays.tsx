import { AboutDialog } from "./about-dialog";
import { CommandPalette } from "./command-palette";
import { GotoLineDialog } from "./goto-line-dialog";
import { SearchPanel } from "./search-panel";
import { SettingsDialog } from "./settings-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { PerfDebugPanel } from "./perf-debug-panel";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { AppOverlayController } from "../hooks/use-app-overlays";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";

interface AppOverlaysProps {
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "updateSetting" | "theme" | "setTheme"
  >;
  editor: Pick<
    AppEditorShellController,
    "handleSearchResult" | "pluginManager" | "handleGotoLine" | "cursorLineCol"
  >;
  overlays: AppOverlayController;
}

export function AppOverlays({ workspace, editor, overlays }: AppOverlaysProps) {
  return (
    <>
      <CommandPalette
        open={overlays.dialogs.paletteOpen}
        onOpenChange={overlays.dialogs.setPaletteOpen}
        commands={overlays.commands}
      />
      <SearchPanel
        open={overlays.dialogs.searchOpen}
        onOpenChange={overlays.dialogs.setSearchOpen}
        onResultSelect={(file, pos) => {
          editor.handleSearchResult(file, pos, () => overlays.dialogs.setSearchOpen(false));
        }}
        indexer={overlays.indexer}
      />
      <SettingsDialog
        open={overlays.dialogs.settingsOpen}
        onOpenChange={overlays.dialogs.setSettingsOpen}
        settings={workspace.settings}
        onUpdateSetting={workspace.updateSetting}
        theme={workspace.theme}
        onSetTheme={workspace.setTheme}
        plugins={editor.pluginManager.getPlugins()}
      />
      <AboutDialog open={overlays.dialogs.aboutOpen} onClose={overlays.dialogs.closeAbout} />
      <ShortcutsDialog
        open={overlays.dialogs.shortcutsOpen}
        onClose={overlays.dialogs.closeShortcuts}
      />
      <GotoLineDialog
        open={overlays.dialogs.gotoLineOpen}
        onOpenChange={overlays.dialogs.setGotoLineOpen}
        onGoto={(line, col) => {
          editor.handleGotoLine(line, col);
          overlays.dialogs.setGotoLineOpen(false);
        }}
        currentLine={editor.cursorLineCol.line}
      />
      <PerfDebugPanel />
    </>
  );
}
