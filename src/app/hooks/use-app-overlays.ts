import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dispatchFormatEvent,
  type FormatEventDetail,
  type HeadingFormatLevel,
  type SimpleFormatEventType,
} from "../../constants/events";
import { BackgroundIndexer } from "../../index";
import { documentAnalysisField } from "../../state/document-analysis";
import { useDevSettings } from "../../state/dev-settings";
import {
  type DocumentLabelBacklinksResult,
  resolveDocumentLabelBacklinks,
} from "../../semantics/document-label-backlinks";
import {
  type DocumentLabelRenameTarget,
  prepareDocumentLabelRename,
  resolveDocumentLabelRenameTarget,
} from "../../semantics/document-label-rename";
import type { PaletteCommand } from "../components/command-palette";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import { dispatchIfConnected } from "../lib/view-dispatch";
import { collectSearchableMarkdownPaths } from "../search";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";
import { useAutoSave } from "./use-auto-save";
import { applyMarkdownFormatAction } from "../editor-format-actions";
import { measureAsync } from "../perf";
import type { UseDialogsReturn } from "./use-dialogs";
import { type HotkeyBinding, useHotkeys } from "./use-hotkeys";
import { useMenuEvents } from "./use-menu-events";
import type { SidebarLayoutController } from "./use-sidebar-layout";

interface AppOverlayDeps {
  fs: FileSystem;
  dialogs: UseDialogsReturn;
  suspendAutoSave: boolean;
  suspendAutoSaveVersion: number;
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
    "currentPath" | "activeDocumentSignal" | "getCurrentDocText" | "getLexicalEditorHandle" | "editorState" | "openFile" | "saveFile" | "saveAs" | "closeCurrentFile" | "hasDirtyDocument" | "pluginManager" | "handleInsertImage" | "editorMode"
  >;
  onOpenFile: () => void;
  onQuit: () => void;
}

export interface AppOverlayController {
  commands: PaletteCommand[];
  indexer: BackgroundIndexer;
  searchVersion: number;
  openPalette: () => void;
  labelBacklinks: DocumentLabelBacklinksResult | null;
  closeLabelBacklinks: () => void;
}

// ── Command registry ─────────────────────────────────────────────────────────

/**
 * A single command definition that serves as the source of truth for the
 * command palette, keyboard shortcuts, and native menu event wiring.
 */
interface CommandDef {
  /** Unique command identifier (e.g., "file.save"). */
  id: string;
  /** Display label shown in the command palette. */
  label: string;
  /** Category for palette grouping. */
  category?: string;
  /** Display-only shortcut hint (e.g., "Cmd+S"). */
  shortcut?: string;
  /** Hotkey binding string (e.g., "mod+s"). Registers a global keyboard shortcut. */
  hotkey?: string;
  /** Tauri menu event ID (e.g., "file_save"). Wires the native menu bar. */
  menuId?: string;
  /** Action executed from the command palette or native menu. */
  action: () => void;
  /**
   * Optional hotkey handler override. Some commands need different behavior
   * when triggered via hotkey (e.g., toggling a dialog) vs palette (opening).
   * Defaults to `action` when not provided.
   */
  hotkeyAction?: () => void;
}

/** Extract PaletteCommand[] from the registry. */
function toPaletteCommands(defs: CommandDef[]): PaletteCommand[] {
  return defs.map(({ id, label, category, shortcut, action }) => ({
    id, label, category, shortcut, action,
  }));
}

/** Extract HotkeyBinding[] from entries that declare a hotkey. */
function toHotkeyBindings(defs: CommandDef[]): HotkeyBinding[] {
  const result: HotkeyBinding[] = [];
  for (const d of defs) {
    if (d.hotkey) {
      result.push({ key: d.hotkey, handler: d.hotkeyAction ?? d.action });
    }
  }
  return result;
}

/** Extract a menuId → handler map from entries that declare a menuId. */
function toMenuHandlers(defs: CommandDef[]): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const d of defs) {
    if (d.menuId) map[d.menuId] = d.action;
  }
  return map;
}

const LABEL_ACTION_MESSAGE =
  "Place the cursor on a local label definition or reference in the current document.";
const ACTIVE_SEARCH_REINDEX_DEBOUNCE_MS = 120;
const ACTIVE_SEARCH_REINDEX_IDLE_TIMEOUT_MS = 1_000;

type IdleTaskHandle = number;
type IdleTaskDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};
type WindowWithIdleTask = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleTaskDeadline) => void,
    options?: { readonly timeout?: number },
  ) => IdleTaskHandle;
  cancelIdleCallback?: (handle: IdleTaskHandle) => void;
};

function scheduleDebouncedIdleTask(
  task: () => void,
): () => void {
  let idleHandle: IdleTaskHandle | null = null;
  const timeoutHandle = window.setTimeout(() => {
    const idleWindow = window as WindowWithIdleTask;
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(() => {
        idleHandle = null;
        task();
      }, { timeout: ACTIVE_SEARCH_REINDEX_IDLE_TIMEOUT_MS });
      return;
    }
    task();
  }, ACTIVE_SEARCH_REINDEX_DEBOUNCE_MS);

  return () => {
    window.clearTimeout(timeoutHandle);
    if (idleHandle !== null) {
      const idleWindow = window as WindowWithIdleTask;
      idleWindow.cancelIdleCallback?.(idleHandle);
    }
  };
}

function duplicateRenameMessage(id: string): string {
  return `Local label "${id}" is defined more than once in this document. Resolve the duplicate label before renaming it.`;
}

function renamePromptMessage(target: DocumentLabelRenameTarget): string {
  const referenceCount = target.references.length;
  const referenceWord = referenceCount === 1 ? "reference" : "references";
  return [
    `Rename local label "${target.definition.id}" to:`,
    `This will update 1 definition and ${referenceCount} ${referenceWord} in the current document.`,
  ].join("\n\n");
}

function renameValidationMessage(nextId: string): string {
  return [
    `Cannot rename label to "${nextId.trim()}".`,
    "Use a non-empty id with no spaces. Allowed characters: letters, numbers, _, ., :, and -.",
  ].join("\n\n");
}

function dispatchFormatDetail(detail: FormatEventDetail): void {
  if (detail.type === "heading") {
    dispatchFormatEvent("heading", { level: detail.level });
    return;
  }
  dispatchFormatEvent(detail.type);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAppOverlays({
  fs,
  dialogs,
  suspendAutoSave,
  suspendAutoSaveVersion,
  workspace,
  sidebarLayout,
  editor,
  onOpenFile,
  onQuit,
}: AppOverlayDeps): AppOverlayController {
  const [indexer] = useState(() => new BackgroundIndexer());
  const [searchSyncRevision, setSearchSyncRevision] = useState(0);
  const [searchVersion, setSearchVersion] = useState(0);
  const [labelBacklinks, setLabelBacklinks] = useState<DocumentLabelBacklinksResult | null>(null);
  const activeSearchAnalysis = editor.editorState?.view?.state.field(documentAnalysisField, false);
  const activeSearchDoc = useMemo(
    () => (
      dialogs.searchOpen && editor.currentPath
        ? editor.getCurrentDocText()
        : ""
    ),
    [dialogs.searchOpen, editor.currentPath, searchSyncRevision, editor.getCurrentDocText],
  );

  useEffect(() => {
    setLabelBacklinks(null);
  }, [editor.currentPath]);

  useEffect(() => {
    if (labelBacklinks === null) {
      return;
    }

    return editor.activeDocumentSignal.subscribe(() => {
      setLabelBacklinks(null);
    });
  }, [editor.activeDocumentSignal, labelBacklinks]);

  useEffect(() => {
    if (!dialogs.searchOpen) {
      setSearchSyncRevision(0);
      return;
    }

    return editor.activeDocumentSignal.subscribe(() => {
      setSearchSyncRevision((revision) => revision + 1);
    });
  }, [dialogs.searchOpen, editor.activeDocumentSignal]);

  useEffect(() => {
    if (!dialogs.searchOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const tree = await fs.listTree();
        const markdownPaths = collectSearchableMarkdownPaths(tree);
        const files = await Promise.all(
          markdownPaths.map(async (path) => ({
            file: path,
            content:
              path === editor.currentPath
                ? activeSearchDoc
                : await fs.readFile(path),
            analysis:
              path === editor.currentPath
                ? activeSearchAnalysis
                : undefined,
          })),
        );

        if (!cancelled) {
          await measureAsync(
            "search.index.bulkUpdate",
            () => indexer.bulkUpdate(files),
            {
              category: "search",
              detail: `${files.length} files`,
            },
          );
          setSearchVersion((version) => version + 1);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[search] failed to build app search index", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dialogs.searchOpen,
    workspace.fileTree,
    fs,
    indexer,
  ]);

  useEffect(() => {
    if (
      !dialogs.searchOpen ||
      searchSyncRevision === 0 ||
      !editor.currentPath?.endsWith(".md")
    ) {
      return;
    }

    const currentPath = editor.currentPath;
    let cancelled = false;
    const cancelScheduledSync = scheduleDebouncedIdleTask(() => {
      void measureAsync(
        "search.index.updateFile",
        () => indexer.updateFile(currentPath, activeSearchDoc, activeSearchAnalysis),
        {
          category: "search",
          detail: currentPath,
        },
      )
        .then(() => {
          if (!cancelled) {
            setSearchVersion((version) => version + 1);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            console.error("[search] failed to sync active file into app search index", error);
          }
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledSync();
    };
  }, [
    dialogs.searchOpen,
    indexer,
    editor.currentPath,
    activeSearchDoc,
    activeSearchAnalysis,
    searchSyncRevision,
  ]);

  const handleExportHtml = useCallback(() => {
    const currentPath = editor.currentPath;
    if (!currentPath) return;
    const doc = editor.getCurrentDocText();
    void (async () => {
      try {
        const { exportDocument } = await import("../export");
        const outputPath = await exportDocument(doc, "html", currentPath, fs);
        window.alert(`Exported to ${outputPath}`);
      } catch (err: unknown) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [editor.currentPath, editor.getCurrentDocText, fs]);

  const handleBatchExportHtml = useCallback(() => {
    if (!workspace.fileTree) return;
    void (async () => {
      const { batchExport } = await import("../export");
      // Fetch the full recursive tree at export time so that all nested
      // markdown files are included, even when the sidebar tree is shallow.
      const tree = await fs.listTree();
      const results = await batchExport(tree, "html", fs);
      const succeeded = results.filter((result) => result.outputPath);
      const failed = results.filter((result) => result.error);
      const summary = [`Batch export complete: ${succeeded.length} succeeded`];
      if (failed.length > 0) {
        summary.push(`${failed.length} failed`);
        for (const failure of failed) {
          summary.push(`  ${failure.path}: ${failure.error}`);
        }
      }
      window.alert(summary.join("\n"));
    })().catch((e: unknown) => {
      window.alert(`Batch export failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [workspace.fileTree, fs]);

  const handleSaveAs = useCallback(() => {
    void editor.saveAs().catch((e: unknown) => {
      console.error("[overlays] save-as failed", e);
    });
  }, [editor]);

  const applyFormat = useCallback((detail: FormatEventDetail) => {
    const handled = applyMarkdownFormatAction({
      editorHandle: editor.getLexicalEditorHandle(),
      getCurrentDocText: editor.getCurrentDocText,
    }, detail);
    if (!handled) {
      dispatchFormatDetail(detail);
    }
  }, [editor]);

  const applySimpleFormat = useCallback((type: SimpleFormatEventType) => {
    applyFormat({ type });
  }, [applyFormat]);

  const applyHeading = useCallback((level: HeadingFormatLevel) => {
    applyFormat({ type: "heading", level });
  }, [applyFormat]);

  const handleShowLabelBacklinks = useCallback(() => {
    const view = editor.editorState?.view;
    if (!view || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    const lookup = resolveDocumentLabelBacklinks(view.state);
    if (lookup.kind === "ready") {
      setLabelBacklinks(lookup.result);
      return;
    }

    if (lookup.kind === "duplicate") {
      window.alert(
        `Local label "${lookup.id}" is defined more than once in this document. Resolve the duplicate label before showing references.`,
      );
      return;
    }

    window.alert(LABEL_ACTION_MESSAGE);
  }, [editor.currentPath, editor.editorState?.view]);

  const handleRenameDocumentLabel = useCallback(() => {
    const view = editor.editorState?.view;
    if (!view || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    const lookup = resolveDocumentLabelRenameTarget(view.state);
    if (lookup.kind === "duplicate") {
      window.alert(duplicateRenameMessage(lookup.id));
      return;
    }
    if (lookup.kind === "none") {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    const target = lookup.target;
    const promptedId = window.prompt(
      renamePromptMessage(target),
      target.definition.id,
    );
    if (promptedId === null || promptedId === target.definition.id) {
      return;
    }

    const rename = prepareDocumentLabelRename(view.state, promptedId);
    if (rename.kind === "ready") {
      if (rename.changes.length === 0) return;
      if (dispatchIfConnected(
        view,
        { changes: [...rename.changes], scrollIntoView: true },
        { context: "[rename-label] dispatch failed:" },
      )) {
        view.focus();
        window.requestAnimationFrame(() => {
          if (view.dom.isConnected) {
            view.focus();
          }
        });
      }
      return;
    }

    if (rename.kind === "duplicate") {
      window.alert(duplicateRenameMessage(rename.id));
      return;
    }
    if (rename.kind === "invalid") {
      if (rename.validation.reason === "collision") {
        window.alert(
          `Local label "${rename.validation.id}" already exists in this document. Choose a different id.`,
        );
      } else {
        window.alert(renameValidationMessage(promptedId));
      }
      return;
    }

    window.alert(LABEL_ACTION_MESSAGE);
  }, [editor.currentPath, editor.editorState?.view]);

  // ── Single command registry ──────────────────────────────────────────────
  // Each command is defined once. Palette entries, hotkey bindings, and
  // Tauri menu handlers are all derived from this array.

  const commandDefs: CommandDef[] = useMemo(() => [
    // ── File ──────────────────────────────────────────────────────────────
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, hotkey: "mod+s", menuId: "file_save", action: () => { void editor.saveFile(); } },
    { id: "file.open-file", label: "Open File...", category: "File", shortcut: `${modKey}+O`, menuId: "file_open_file", action: () => onOpenFile() },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, hotkey: "mod+shift+s", menuId: "file_save_as", action: handleSaveAs },
    { id: "file.close-file", label: "Close File", category: "File", shortcut: `${modKey}+W`, menuId: "file_close_tab", action: () => { void editor.closeCurrentFile(); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", menuId: "file_open_folder", action: () => workspace.handleOpenFolder() },
    { id: "file.quit", label: "Quit App", category: "File", shortcut: `${modKey}+Q`, menuId: "file_quit", action: onQuit },

    // ── Format ────────────────────────────────────────────────────────────
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, menuId: "format_bold", action: () => applySimpleFormat("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, menuId: "format_italic", action: () => applySimpleFormat("italic") },
    { id: "format.code", label: "Toggle Code", category: "Format", menuId: "format_code", action: () => applySimpleFormat("code") },
    { id: "format.strikethrough", label: "Toggle Strikethrough", category: "Format", menuId: "format_strikethrough", action: () => applySimpleFormat("strikethrough") },
    { id: "format.highlight", label: "Toggle Highlight", category: "Format", menuId: "format_highlight", action: () => applySimpleFormat("highlight") },
    { id: "format.link", label: "Insert Link", category: "Format", menuId: "format_link", action: () => applySimpleFormat("link") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => applyHeading(1) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => applyHeading(2) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => applyHeading(3) },

    // ── Edit ──────────────────────────────────────────────────────────────
    { id: "edit.rename-local-label", label: "Rename Local Label", category: "Edit", action: handleRenameDocumentLabel },

    // ── Navigation ────────────────────────────────────────────────────────
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, hotkey: "mod+g", action: () => dialogs.setGotoLineOpen(true), hotkeyAction: () => dialogs.setGotoLineOpen((value) => !value) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("outline"); } },
    { id: "nav.show-diagnostics", label: "Show Diagnostics Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("diagnostics"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, hotkey: "mod+shift+f", menuId: "edit_find", action: () => dialogs.setSearchOpen(true), hotkeyAction: () => dialogs.setSearchOpen((value) => !value) },
    { id: "nav.show-label-references", label: "Show References to Label", category: "Navigation", action: handleShowLabelBacklinks },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, hotkey: "mod+,", action: () => dialogs.setSettingsOpen(true), hotkeyAction: () => dialogs.setSettingsOpen((value) => !value) },

    // ── View ──────────────────────────────────────────────────────────────
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, hotkey: "mod+\\", menuId: "view_toggle_sidebar", action: () => sidebarLayout.setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => sidebarLayout.setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark") },
    { id: "view.toggle-fps", label: "Toggle FPS Meter", category: "View", action: () => useDevSettings.getState().toggle("fpsCounter") },
    { id: "view.toggle-selection-always-on", label: "Toggle Selection Always On", category: "View", action: () => useDevSettings.getState().toggle("selectionAlwaysOn") },
    { id: "view.toggle-tree-view", label: "Toggle Tree View", category: "View", action: () => useDevSettings.getState().toggle("treeView") },
    { id: "view.toggle-perf-panel", label: "Toggle Perf Panel", category: "View", action: () => useDevSettings.getState().toggle("perfPanel") },
    { id: "view.toggle-command-log", label: "Toggle Command Log", category: "View", action: () => useDevSettings.getState().toggle("commandLogging") },
    { id: "view.toggle-focus-tracing", label: "Toggle Focus Tracing", category: "View", action: () => useDevSettings.getState().toggle("focusTracing") },

    // ── Insert ────────────────────────────────────────────────────────────
    { id: "insert.image", label: "Insert Image", category: "Insert", action: () => editor.handleInsertImage() },

    // ── Export ────────────────────────────────────────────────────────────
    { id: "export.html", label: "Export Current File to HTML", category: "Export", menuId: "file_export", action: handleExportHtml },
    { id: "export.batch-html", label: "Export All Files to HTML", category: "Export", action: handleBatchExportHtml },

    // ── Help ──────────────────────────────────────────────────────────────
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, hotkey: "mod+/", menuId: "help_shortcuts", action: () => dialogs.setShortcutsOpen(true), hotkeyAction: () => dialogs.setShortcutsOpen((value) => !value) },
    { id: "help.about", label: "About Coflats", category: "Help", menuId: "help_about", action: () => dialogs.setAboutOpen(true) },

    // ── Recent files (palette only) ──────────────────────────────────────
    ...(workspace.recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void editor.openFile(path); },
    })),
  ], [applyHeading, applySimpleFormat, dialogs, editor, workspace, sidebarLayout, handleExportHtml, handleBatchExportHtml, handleSaveAs, handleShowLabelBacklinks, handleRenameDocumentLabel, onOpenFile, onQuit]);

  // ── Derive palette commands, hotkeys, and menu handlers ────────────────
  const commands = useMemo(() => toPaletteCommands(commandDefs), [commandDefs]);

  const hotkeys = useMemo(() => [
    // Palette toggle is a meta-command — not in the palette itself.
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((value) => !value) },
    ...toHotkeyBindings(commandDefs),
  ], [commandDefs, dialogs]);

  const menuHandlers = useMemo(() => toMenuHandlers(commandDefs), [commandDefs]);

  useAutoSave(
    editor.hasDirtyDocument,
    editor.saveFile,
    workspace.settings.autoSaveInterval,
    suspendAutoSave,
    suspendAutoSaveVersion,
  );

  useHotkeys(hotkeys);
  useMenuEvents(menuHandlers);

  return {
    commands,
    indexer,
    searchVersion,
    openPalette: () => dialogs.setPaletteOpen(true),
    labelBacklinks,
    closeLabelBacklinks: () => setLabelBacklinks(null),
  };
}
