import type { BackgroundIndexer } from "../../index";
import type { DocumentLabelBacklinksResult } from "../../semantics/document-label-backlinks";
import type { PaletteCommand } from "../components/command-palette";
import type { FileSystem } from "../file-manager";
import { useAppCommandRegistry } from "./use-app-command-registry";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";
import { useDocumentLabelActions } from "./use-document-label-actions";
import type { UseDialogsReturn } from "./use-dialogs";
import { useSearchIndexSync } from "./use-search-index-sync";
import type { SidebarLayoutController } from "./use-sidebar-layout";

interface AppOverlayDeps {
  fs: FileSystem;
  dialogs: UseDialogsReturn;
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "theme" | "setTheme" | "resolvedTheme" | "recentFiles" | "fileTree" | "handleOpenFolder"
  >;
  sidebarLayout: Pick<
    SidebarLayoutController,
    "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentPath" | "activeDocumentSignal" | "getCurrentDocText" | "getLexicalEditorHandle" | "editorState" | "openFile" | "saveFile" | "saveAs" | "closeCurrentFile" | "hasDirtyDocument" | "handleInsertImage" | "editorMode"
  >;
  onOpenFile: () => void;
  onQuit: () => void;
}

export interface AppOverlayController {
  commands: PaletteCommand[];
  indexer: BackgroundIndexer | null;
  searchVersion: number;
  openPalette: () => void;
  labelBacklinks: DocumentLabelBacklinksResult | null;
  closeLabelBacklinks: () => void;
}

export function useAppOverlays({
  fs,
  dialogs,
  workspace,
  sidebarLayout,
  editor,
  onOpenFile,
  onQuit,
}: AppOverlayDeps): AppOverlayController {
  const searchIndex = useSearchIndexSync({
    fs,
    searchOpen: dialogs.searchOpen,
    fileTree: workspace.fileTree,
    editor,
  });
  const documentLabelActions = useDocumentLabelActions({ editor });
  const commands = useAppCommandRegistry({
    fs,
    dialogs,
    workspace,
    sidebarLayout,
    editor,
    onOpenFile,
    onQuit,
    onShowLabelBacklinks: documentLabelActions.showLabelBacklinks,
    onRenameDocumentLabel: documentLabelActions.renameDocumentLabel,
  });

  return {
    commands,
    indexer: searchIndex.indexer,
    searchVersion: searchIndex.searchVersion,
    openPalette: () => dialogs.setPaletteOpen(true),
    labelBacklinks: documentLabelActions.labelBacklinks,
    closeLabelBacklinks: documentLabelActions.closeLabelBacklinks,
  };
}
