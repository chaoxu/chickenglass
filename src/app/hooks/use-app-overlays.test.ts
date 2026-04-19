import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackgroundIndexer } from "../../index";
import { createActiveDocumentSignal } from "../active-document-signal";
import type { PaletteCommand } from "../components/command-palette";
import { useDevSettings } from "../../state/dev-settings";
import { MemoryFileSystem } from "../file-manager";
import type { Settings } from "../lib/types";

const overlayHookState = vi.hoisted(() => ({
  hotkeys: [] as Array<{ key: string; handler: () => void }>,
  menuHandlers: {} as Record<string, () => void>,
  autoSaveArgs: null as unknown[] | null,
  reset() {
    overlayHookState.hotkeys = [];
    overlayHookState.menuHandlers = {};
    overlayHookState.autoSaveArgs = null;
  },
}));

vi.mock("./use-auto-save", () => ({
  useAutoSave: (...args: unknown[]) => {
    overlayHookState.autoSaveArgs = args;
  },
}));

vi.mock("./use-hotkeys", () => ({
  useHotkeys: (bindings: Array<{ key: string; handler: () => void }>) => {
    overlayHookState.hotkeys = bindings;
  },
}));

vi.mock("./use-menu-events", () => ({
  useMenuEvents: (handlers: Record<string, () => void>) => {
    overlayHookState.menuHandlers = handlers;
  },
}));

const { useAppOverlays } = await import("./use-app-overlays");

type UseAppOverlaysProps = Parameters<typeof useAppOverlays>[0];

const defaultSettings: Settings = {
  autoSaveInterval: 30_000,
  fontSize: 16,
  lineHeight: 1.6,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellCheck: false,
  editorMode: "lexical",
  theme: "system",
  defaultExportFormat: "pdf",
  enabledPlugins: {},
  themeName: "default",
  writingTheme: "academic",
  customCss: "",
  skipDirtyConfirm: true,
};

function createBooleanSetter() {
  return vi.fn<(value: boolean | ((value: boolean) => boolean)) => void>();
}

function createDialogs(
  overrides: Partial<UseAppOverlaysProps["dialogs"]> = {},
): UseAppOverlaysProps["dialogs"] {
  return {
    paletteOpen: false,
    searchOpen: false,
    settingsOpen: false,
    aboutOpen: false,
    shortcutsOpen: false,
    gotoLineOpen: false,
    setPaletteOpen: createBooleanSetter(),
    setSearchOpen: createBooleanSetter(),
    setSettingsOpen: createBooleanSetter(),
    setAboutOpen: createBooleanSetter(),
    setShortcutsOpen: createBooleanSetter(),
    setGotoLineOpen: createBooleanSetter(),
    closeAbout: vi.fn(),
    closeShortcuts: vi.fn(),
    closeGotoLine: vi.fn(),
    ...overrides,
  };
}

function createSidebarLayout(): UseAppOverlaysProps["sidebarLayout"] {
  return {
    setSidebarCollapsed: createBooleanSetter(),
    setSidebarTab: vi.fn(),
    setSidenotesCollapsed: createBooleanSetter(),
  };
}

function getCommand(commands: readonly PaletteCommand[], id: string): PaletteCommand {
  const command = commands.find((candidate) => candidate.id === id);
  expect(command, `expected command ${id}`).toBeDefined();
  if (!command) {
    throw new Error(`missing command ${id}`);
  }
  return command;
}

function getHotkeyHandler(key: string): () => void {
  const binding = overlayHookState.hotkeys.find((candidate) => candidate.key === key);
  expect(binding, `expected hotkey ${key}`).toBeDefined();
  if (!binding) {
    throw new Error(`missing hotkey ${key}`);
  }
  return binding.handler;
}

interface EditorHarnessOptions {
  readonly currentPath?: string | null;
  readonly currentDocText?: string;
  readonly selection?: { from: number; to: number };
}

function createEditorHarness(
  options: EditorHarnessOptions = {},
): {
  readonly editor: UseAppOverlaysProps["editor"];
  readonly activeDocumentSignal: ReturnType<typeof createActiveDocumentSignal>;
  readonly setCurrentDocText: (doc: string) => void;
  readonly setSelection: (from: number, to?: number) => void;
  readonly applyChanges: ReturnType<typeof vi.fn>;
} {
  const activeDocumentSignal = createActiveDocumentSignal();
  let currentDocText = options.currentDocText ?? "";
  let selection = {
    from: options.selection?.from ?? 0,
    to: options.selection?.to ?? options.selection?.from ?? 0,
  };
  const applyChanges = vi.fn((changes: ReadonlyArray<{ from: number; to: number; insert: string }>) => {
    let nextDoc = currentDocText;
    for (let index = changes.length - 1; index >= 0; index -= 1) {
      const change = changes[index];
      nextDoc = `${nextDoc.slice(0, change.from)}${change.insert}${nextDoc.slice(change.to)}`;
    }
    currentDocText = nextDoc;
  });

  return {
    editor: {
      currentPath: options.currentPath ?? null,
      activeDocumentSignal,
      getCurrentDocText: vi.fn(() => currentDocText),
      peekCurrentDocText: vi.fn(() => currentDocText),
      editorHandle: {
        applyChanges,
        focus: vi.fn(),
        getSelection: vi.fn(() => ({
          anchor: selection.to,
          focus: selection.to,
          from: selection.from,
          to: selection.to,
        })),
        insertText: vi.fn(),
        setSelection: vi.fn(),
      },
      openFile: vi.fn(async () => {}),
      saveFile: vi.fn(async () => {}),
      saveAs: vi.fn(async () => {}),
      closeCurrentFile: vi.fn(async () => true),
      hasDirtyDocument: false,
      pluginManager: {
        getPlugins: vi.fn(() => []),
      } as unknown as UseAppOverlaysProps["editor"]["pluginManager"],
      handleInsertImage: vi.fn(),
    },
    activeDocumentSignal,
    setCurrentDocText: (doc) => {
      currentDocText = doc;
    },
    setSelection: (from, to = from) => {
      selection = { from, to };
    },
    applyChanges,
  };
}

async function createHookProps(
  options: {
    readonly files?: Record<string, string>;
    readonly currentPath?: string | null;
    readonly currentDocText?: string;
    readonly selection?: { from: number; to: number };
    readonly dialogs?: Partial<UseAppOverlaysProps["dialogs"]>;
    readonly recentFiles?: string[];
  } = {},
) {
  const fs = new MemoryFileSystem(options.files ?? {});
  const dialogs = createDialogs(options.dialogs);
  const sidebarLayout = createSidebarLayout();
  const editorHarness = createEditorHarness({
    currentPath: options.currentPath,
    currentDocText: options.currentDocText,
    selection: options.selection,
  });
  const onOpenFile = vi.fn();
  const onQuit = vi.fn();

  const workspace: UseAppOverlaysProps["workspace"] = {
    settings: defaultSettings,
    theme: "system",
    setTheme: vi.fn(),
    resolvedTheme: "light",
    recentFiles: options.recentFiles ?? [],
    fileTree: await fs.listTree(),
    handleOpenFolder: vi.fn(),
  };

  return {
    props: {
      fs,
      dialogs,
      suspendAutoSave: false,
      suspendAutoSaveRef: { current: false },
      suspendAutoSaveVersionRef: { current: 0 },
      workspace,
      sidebarLayout,
      editor: editorHarness.editor,
      onOpenFile,
      onQuit,
    } satisfies UseAppOverlaysProps,
    fs,
    dialogs,
    editorHarness,
    onOpenFile,
  };
}

describe("useAppOverlays", () => {
  beforeEach(() => {
    overlayHookState.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the search index from markdown files and prefers the live active document", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdate");
    const updateFileSpy = vi.spyOn(BackgroundIndexer.prototype, "updateFile");
    const { props, fs } = await createHookProps({
      files: {
        "notes/current.md": "disk copy",
        "notes/other.md": "# Other\n",
        "notes/ignore.txt": "not markdown",
      },
      currentPath: "notes/current.md",
      currentDocText: "# Live draft\n",
      dialogs: { searchOpen: true },
    });
    const readFileSpy = vi.spyOn(fs, "readFile");

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    await vi.waitFor(() => {
      expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
      expect(result.current.searchVersion).toBeGreaterThan(0);
    });

    expect(updateFileSpy).toHaveBeenCalledWith("notes/current.md", "# Live draft\n");
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith("notes/other.md");
    expect(readFileSpy).not.toHaveBeenCalledWith("notes/current.md");
  });

  it("clears open label backlinks when the active path changes", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See @sec:intro.",
    ].join("\n");
    const { props, editorHarness } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      selection: { from: doc.indexOf("@sec:intro") + 2, to: doc.indexOf("@sec:intro") + 2 },
    });

    const { result, rerender } = renderHook(
      (hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps),
      { initialProps: props },
    );

    act(() => {
      getCommand(result.current.commands, "nav.show-label-references").action();
    });

    await vi.waitFor(() => {
      expect(result.current.labelBacklinks?.definition.id).toBe("sec:intro");
    });

    props.editor.currentPath = "notes/other.md";
    act(() => {
      rerender({ ...props });
    });

    await vi.waitFor(() => {
      expect(result.current.labelBacklinks).toBeNull();
    });

    editorHarness.editor.currentPath = "notes/labels.md";
  });

  it("renames a local label through the overlay command flow", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("thm:renamed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const doc = [
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n");
    const { props, editorHarness } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      selection: { from: doc.indexOf("@thm:main") + 2, to: doc.indexOf("@thm:main") + 2 },
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(editorHarness.applyChanges).toHaveBeenCalledTimes(1);
    expect(props.editor.getCurrentDocText()).toContain("thm:renamed");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("keeps representative palette, hotkey, and menu commands aligned", async () => {
    const { props, dialogs, onOpenFile } = await createHookProps({
      recentFiles: ["notes/recent.md"],
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    getCommand(result.current.commands, "file.open-file").action();
    getCommand(result.current.commands, "nav.search").action();
    overlayHookState.menuHandlers.edit_find?.();
    getHotkeyHandler("mod+shift+f")();

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(1, true);
    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(2, true);
    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(3, true);
  });

  it("toggles selectionAlwaysOn via the palette command", async () => {
    const { props } = await createHookProps({});

    const { result } = renderHook(
      (hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps),
      { initialProps: props },
    );

    expect(useDevSettings.getState().selectionAlwaysOn).toBe(false);
    getCommand(result.current.commands, "view.toggle-selection-always-on").action();
    expect(useDevSettings.getState().selectionAlwaysOn).toBe(true);
    getCommand(result.current.commands, "view.toggle-selection-always-on").action();
    expect(useDevSettings.getState().selectionAlwaysOn).toBe(false);
  });

  it("toggles treeView via the palette command", async () => {
    const { props } = await createHookProps({});

    const { result } = renderHook(
      (hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps),
      { initialProps: props },
    );

    expect(useDevSettings.getState().treeView).toBe(false);
    getCommand(result.current.commands, "view.toggle-tree-view").action();
    expect(useDevSettings.getState().treeView).toBe(true);
    getCommand(result.current.commands, "view.toggle-tree-view").action();
    expect(useDevSettings.getState().treeView).toBe(false);
  });
});
