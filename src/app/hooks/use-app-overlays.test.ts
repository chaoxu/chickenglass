import { act, renderHook } from "@testing-library/react";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteCommand } from "../components/command-palette";
import { createActiveDocumentSignal } from "../active-document-signal";
import { MemoryFileSystem } from "../file-manager";
import type { Settings } from "../lib/types";
import { BackgroundIndexer } from "../../index";
import { frontmatterField } from "../../editor/frontmatter-state";
import { markdownExtensions } from "../../parser";
import {
  createPluginRegistryField,
  defaultPlugins,
} from "../../plugins";
import { documentAnalysisField } from "../../semantics/codemirror-source";
import { documentLabelGraphField } from "../../semantics/document-label-graph";
import { blockCounterField } from "../../state/block-counter";
import { createTestView } from "../../test-utils";

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
  editorMode: "rich",
  theme: "system",
  defaultExportFormat: "pdf",
  enabledPlugins: {},
  themeName: "default",
  writingTheme: "academic",
  customCss: "",
  skipDirtyConfirm: true,
};

const createdViews: EditorView[] = [];

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

interface EditorHarnessOptions {
  currentPath?: string | null;
  currentDocText?: string;
  view?: EditorView | null;
}

function createEditorHarness(
  options: EditorHarnessOptions = {},
): {
  editor: UseAppOverlaysProps["editor"];
  activeDocumentSignal: ReturnType<typeof createActiveDocumentSignal>;
  setCurrentDocText: (nextDoc: string) => void;
} {
  const activeDocumentSignal = createActiveDocumentSignal();
  let currentDocText = options.currentDocText ?? "";
  const editorState = options.view
    ? {
        view: options.view,
        pluginManager: {} as never,
        imageSaver: null,
      }
    : null;

  return {
    editor: {
      currentPath: options.currentPath ?? null,
      activeDocumentSignal,
      getCurrentDocText: vi.fn(() => currentDocText),
      editorState: editorState as UseAppOverlaysProps["editor"]["editorState"],
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
    setCurrentDocText: (nextDoc) => {
      currentDocText = nextDoc;
    },
  };
}

interface HookHarnessOptions {
  files?: Record<string, string>;
  currentPath?: string | null;
  currentDocText?: string;
  view?: EditorView | null;
  dialogs?: Partial<UseAppOverlaysProps["dialogs"]>;
  recentFiles?: string[];
}

async function createHookProps(
  options: HookHarnessOptions = {},
): Promise<{
  props: UseAppOverlaysProps;
  fs: MemoryFileSystem;
  dialogs: UseAppOverlaysProps["dialogs"];
  workspace: UseAppOverlaysProps["workspace"];
  sidebarLayout: UseAppOverlaysProps["sidebarLayout"];
  editor: UseAppOverlaysProps["editor"];
  activeDocumentSignal: ReturnType<typeof createActiveDocumentSignal>;
  setCurrentDocText: (nextDoc: string) => void;
  onOpenFile: ReturnType<typeof vi.fn>;
  onQuit: ReturnType<typeof vi.fn>;
}> {
  const fs = new MemoryFileSystem(options.files ?? {});
  const dialogs = createDialogs(options.dialogs);
  const sidebarLayout = createSidebarLayout();
  const { editor, activeDocumentSignal, setCurrentDocText } = createEditorHarness({
    currentPath: options.currentPath,
    currentDocText: options.currentDocText,
    view: options.view,
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
      suspendAutoSaveVersion: 0,
      workspace,
      sidebarLayout,
      editor,
      onOpenFile,
      onQuit,
    },
    fs,
    dialogs,
    workspace,
    sidebarLayout,
    editor,
    activeDocumentSignal,
    setCurrentDocText,
    onOpenFile,
    onQuit,
  };
}

function labelEditorExtensions() {
  return [
    frontmatterField,
    markdown({ extensions: markdownExtensions }),
    documentAnalysisField,
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    documentLabelGraphField,
  ];
}

function createLabelView(doc: string, cursorPos: number): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    extensions: labelEditorExtensions(),
  });
  createdViews.push(view);
  return view;
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

describe("useAppOverlays", () => {
  beforeEach(() => {
    overlayHookState.reset();
  });

  afterEach(() => {
    while (createdViews.length > 0) {
      createdViews.pop()?.destroy();
    }
    vi.restoreAllMocks();
  });

  it("builds the search index from markdown files, using live editor text for the active file", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdate");
    const updateFileSpy = vi.spyOn(BackgroundIndexer.prototype, "updateFile");
    const {
      props,
      dialogs,
      fs,
      editor,
    } = await createHookProps({
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
    expect(bulkUpdateSpy.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      { file: "notes/current.md", content: "# Live draft\n" },
      { file: "notes/other.md", content: "# Other\n" },
    ]));
    expect(bulkUpdateSpy.mock.calls[0]?.[0]).toHaveLength(2);
    expect(result.current.indexer).toBeInstanceOf(BackgroundIndexer);
    expect(dialogs.searchOpen).toBe(true);
    expect(editor.currentPath).toBe("notes/current.md");
  });

  it("resyncs the active markdown file and bumps searchVersion on active-document edits while search is open", async () => {
    const updateFileSpy = vi.spyOn(BackgroundIndexer.prototype, "updateFile");
    const {
      props,
      setCurrentDocText,
      activeDocumentSignal,
    } = await createHookProps({
      files: {
        "notes/current.md": "# Current\n",
        "notes/other.md": "# Other\n",
      },
      currentPath: "notes/current.md",
      currentDocText: "# Current\n",
      dialogs: { searchOpen: true },
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    await vi.waitFor(() => {
      expect(updateFileSpy).toHaveBeenCalled();
      expect(result.current.searchVersion).toBeGreaterThan(0);
    });

    const initialUpdateCount = updateFileSpy.mock.calls.length;
    const initialSearchVersion = result.current.searchVersion;

    setCurrentDocText("# Updated live draft\n");

    act(() => {
      activeDocumentSignal.publish("notes/current.md");
    });

    await vi.waitFor(() => {
      expect(updateFileSpy).toHaveBeenCalledTimes(initialUpdateCount + 1);
      expect(result.current.searchVersion).toBeGreaterThan(initialSearchVersion);
    });

    expect(updateFileSpy.mock.calls.at(-1)).toEqual([
      "notes/current.md",
      "# Updated live draft\n",
    ]);
  });

  it("clears open label backlinks when the active path changes", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See @sec:intro.",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("@sec:intro") + 2);
    const {
      props,
      editor,
    } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      view,
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

    editor.currentPath = "notes/other.md";

    act(() => {
      rerender({ ...props });
    });

    await vi.waitFor(() => {
      expect(result.current.labelBacklinks).toBeNull();
    });
  });

  it("clears open label backlinks on active-document edits after the dialog has been opened", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See @sec:intro.",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("@sec:intro") + 2);
    const {
      props,
      activeDocumentSignal,
    } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      view,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "nav.show-label-references").action();
    });

    await vi.waitFor(() => {
      expect(result.current.labelBacklinks?.definition.id).toBe("sec:intro");
    });

    act(() => {
      activeDocumentSignal.publish("notes/labels.md");
    });

    await vi.waitFor(() => {
      expect(result.current.labelBacklinks).toBeNull();
    });
  });

  it("keeps representative palette, hotkey, and menu commands aligned", async () => {
    const {
      props,
      dialogs,
      editor,
    } = await createHookProps({
      recentFiles: ["notes/recent.md"],
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    const saveAsCommand = getCommand(result.current.commands, "file.save-as");
    const searchCommand = getCommand(result.current.commands, "nav.search");
    const recentCommand = getCommand(result.current.commands, "file.recent-0");

    saveAsCommand.action();
    overlayHookState.menuHandlers.file_save_as?.();
    getHotkeyHandler("mod+shift+s")();

    expect(editor.saveAs).toHaveBeenCalledTimes(3);

    searchCommand.action();
    overlayHookState.menuHandlers.edit_find?.();
    getHotkeyHandler("mod+shift+f")();

    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(1, true);
    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(2, true);
    expect(dialogs.setSearchOpen).toHaveBeenNthCalledWith(3, expect.any(Function));

    recentCommand.action();

    expect(editor.openFile).toHaveBeenCalledWith("notes/recent.md");
    expect(Object.values(overlayHookState.menuHandlers)).not.toContain(recentCommand.action);
    expect(overlayHookState.hotkeys.map((binding) => binding.handler)).not.toContain(recentCommand.action);
  });

  it("renames a local label through the hook command flow", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("thm:renamed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const doc = [
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n");
    const expectedDoc = [
      "::: {.theorem #thm:renamed} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:renamed].",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("@thm:main") + 2);
    const { props } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      view,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe(expectedDoc);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("alerts instead of renaming when the selected label is duplicated", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("dup-renamed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const doc = [
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup} Duplicate",
      "Body.",
      ":::",
      "",
      "See [@dup].",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("@dup") + 2);
    const { props } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      view,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Local label "dup" is defined more than once in this document. Resolve the duplicate label before renaming it.',
    );
  });

  it("alerts on invalid rename targets without dispatching changes", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("sec:overview");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const doc = [
      "# Intro {#sec:intro}",
      "",
      "# Overview {#sec:overview}",
      "",
      "See @sec:intro.",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("@sec:intro") + 2);
    const originalDoc = view.state.doc.toString();
    const { props } = await createHookProps({
      currentPath: "notes/labels.md",
      currentDocText: doc,
      view,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Local label "sec:overview" already exists in this document. Choose a different id.',
    );
    expect(view.state.doc.toString()).toBe(originalDoc);
  });

  it("alerts when rename is requested with no local label under the cursor", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("unused");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const doc = [
      "Paragraph.",
      "",
      "Still no labels here.",
    ].join("\n");
    const view = createLabelView(doc, doc.indexOf("Paragraph"));
    const { props } = await createHookProps({
      currentPath: "notes/plain.md",
      currentDocText: doc,
      view,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Place the cursor on a local label definition or reference in the current document.",
    );
  });
});
