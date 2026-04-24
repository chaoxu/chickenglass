import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frontmatterField } from "../../editor/frontmatter-state";
import { BackgroundIndexer } from "../../index";
import { markdownExtensions } from "../../parser";
import {
  defaultPlugins,
} from "../../plugins";
import { documentAnalysisField } from "../../state/document-analysis";
import { documentLabelGraphField } from "../../state/document-label-graph";
import { blockCounterField } from "../../state/block-counter";
import { createPluginRegistryField } from "../../state/plugin-registry";
import { createTestView } from "../../test-utils";
import { createActiveDocumentSignal } from "../active-document-signal";
import type { PaletteCommand } from "../components/command-palette";
import { MemoryFileSystem } from "../file-manager";
import type { Settings } from "../lib/types";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";

const overlayHookState = vi.hoisted(() => ({
  hotkeys: [] as Array<{ key: string; handler: () => void }>,
  menuHandlers: {} as Record<string, () => void>,
  reset() {
    overlayHookState.hotkeys = [];
    overlayHookState.menuHandlers = {};
  },
}));

const exportModuleState = vi.hoisted(() => ({
  exportDocument: vi.fn(async () => "notes/current.html"),
  batchExport: vi.fn(async () => []),
  reset() {
    exportModuleState.exportDocument.mockReset();
    exportModuleState.exportDocument.mockResolvedValue("notes/current.html");
    exportModuleState.batchExport.mockReset();
    exportModuleState.batchExport.mockResolvedValue([]);
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

vi.mock("../export", () => ({
  exportDocument: exportModuleState.exportDocument,
  batchExport: exportModuleState.batchExport,
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
  editorMode: "cm6-rich",
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
  lexicalEditorHandle?: MarkdownEditorHandle | null;
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
      getLexicalEditorHandle: vi.fn(() => options.lexicalEditorHandle ?? null),
      editorState: editorState as UseAppOverlaysProps["editor"]["editorState"],
      openFile: vi.fn(async () => {}),
      saveFile: vi.fn(async () => {}),
      saveAs: vi.fn(async () => {}),
      closeCurrentFile: vi.fn(async () => true),
      hasDirtyDocument: false,
      editorMode: "cm6-rich",
      handleInsertImage: vi.fn(),
    },
    activeDocumentSignal,
    setCurrentDocText: (nextDoc) => {
      currentDocText = nextDoc;
      options.view?.dispatch({
        changes: {
          from: 0,
          to: options.view.state.doc.length,
          insert: nextDoc,
        },
      });
    },
  };
}

interface HookHarnessOptions {
  files?: Record<string, string>;
  currentPath?: string | null;
  currentDocText?: string;
  lexicalEditorHandle?: MarkdownEditorHandle | null;
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
  onOpenFolder: ReturnType<typeof vi.fn>;
  onQuit: ReturnType<typeof vi.fn>;
}> {
  const fs = new MemoryFileSystem(options.files ?? {});
  const dialogs = createDialogs(options.dialogs);
  const sidebarLayout = createSidebarLayout();
  const { editor, activeDocumentSignal, setCurrentDocText } = createEditorHarness({
    currentPath: options.currentPath,
    currentDocText: options.currentDocText,
    lexicalEditorHandle: options.lexicalEditorHandle,
    view: options.view,
  });
  const onOpenFile = vi.fn();
  const onOpenFolder = vi.fn();
  const onQuit = vi.fn();

  const workspace: UseAppOverlaysProps["workspace"] = {
    settings: defaultSettings,
    theme: "system",
    setTheme: vi.fn(),
    resolvedTheme: "light",
    recentFiles: options.recentFiles ?? [],
    fileTree: await fs.listTree(),
  };

  return {
    props: {
      fs,
      dialogs,
      workspace,
      sidebarLayout,
      editor,
      onOpenFile,
      onOpenFolder,
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
    onOpenFolder,
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

function createSearchIndexView(doc: string): EditorView {
  const view = createTestView(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
    ],
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

function flushAsyncImports(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("useAppOverlays", () => {
  beforeEach(() => {
    overlayHookState.reset();
    exportModuleState.reset();
  });

  afterEach(() => {
    while (createdViews.length > 0) {
      createdViews.pop()?.destroy();
    }
    vi.restoreAllMocks();
  });

  it("builds the search index from markdown files, using live editor text for the active file", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdateChunked");
    const view = createSearchIndexView("# Live draft\n");
    const activeAnalysis = view.state.field(documentAnalysisField);
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
      view,
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

    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith("notes/other.md");
    expect(readFileSpy).not.toHaveBeenCalledWith("notes/current.md");
    expect(bulkUpdateSpy.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      {
        file: "notes/current.md",
        content: "# Live draft\n",
        analysis: activeAnalysis,
      },
      { file: "notes/other.md", content: "# Other\n" },
    ]));
    expect(bulkUpdateSpy.mock.calls[0]?.[0]).toHaveLength(2);
    expect(result.current.indexer).toBeInstanceOf(BackgroundIndexer);
    expect(dialogs.searchOpen).toBe(true);
    expect(editor.currentPath).toBe("notes/current.md");
  });

  it("does not pair stale active-file content with a newer analysis while search opens", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdateChunked");
    const view = createSearchIndexView("# A\n");
    const first = await createHookProps({
      files: {
        "notes/a.md": "# A on disk\n",
        "notes/b.md": "# B on disk\n",
      },
      currentPath: "notes/a.md",
      currentDocText: "# A\n",
      view,
      dialogs: { searchOpen: true },
    });
    const second = await createHookProps({
      files: {
        "notes/a.md": "# A on disk\n",
        "notes/b.md": "# B on disk\n",
      },
      currentPath: "notes/b.md",
      currentDocText: "# B\n",
      view,
      dialogs: { searchOpen: true },
    });

    const { rerender } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: first.props,
    });
    first.setCurrentDocText("# B\n");
    rerender(second.props);

    await vi.waitFor(() => {
      expect(bulkUpdateSpy).toHaveBeenCalled();
    });

    for (const [files] of bulkUpdateSpy.mock.calls) {
      const staleEntry = files.find((file) => file.file === "notes/a.md" && file.content === "# A\n");
      if (staleEntry) {
        expect(staleEntry.analysis).toBeUndefined();
      }
    }
  });

  it("limits concurrent search index file reads", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdateChunked");
    const files = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [
        `notes/file-${index}.md`,
        `# File ${index}\n`,
      ]),
    );
    const {
      props,
      fs,
    } = await createHookProps({
      files,
      dialogs: { searchOpen: true },
    });
    const originalReadFile = fs.readFile.bind(fs);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(fs, "readFile").mockImplementation(async (path) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      try {
        return await originalReadFile(path);
      } finally {
        inFlight -= 1;
      }
    });

    renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    await vi.waitFor(() => {
      expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it("resyncs the active markdown file and bumps searchVersion on active-document edits while search is open", async () => {
    const bulkUpdateSpy = vi.spyOn(BackgroundIndexer.prototype, "bulkUpdateChunked");
    const updateFileDeferredSpy = vi.spyOn(BackgroundIndexer.prototype, "updateFileDeferred");
    const view = createSearchIndexView("# Current\n");
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
      view,
      dialogs: { searchOpen: true },
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    await vi.waitFor(() => {
      expect(bulkUpdateSpy).toHaveBeenCalled();
      expect(result.current.searchVersion).toBeGreaterThan(0);
    });

    const getCurrentDocText = vi.mocked(props.editor.getCurrentDocText);
    const initialUpdateCount = updateFileDeferredSpy.mock.calls.length;
    const initialSearchVersion = result.current.searchVersion;
    const initialDocReadCount = getCurrentDocText.mock.calls.length;

    setCurrentDocText("# Updated live draft\n");

    act(() => {
      activeDocumentSignal.publish("notes/current.md");
    });

    expect(getCurrentDocText).toHaveBeenCalledTimes(initialDocReadCount);

    await vi.waitFor(() => {
      expect(updateFileDeferredSpy).toHaveBeenCalledTimes(initialUpdateCount + 1);
      expect(result.current.searchVersion).toBeGreaterThan(initialSearchVersion);
    });

    const updatedAnalysis = view.state.field(documentAnalysisField);
    expect(updateFileDeferredSpy.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      "notes/current.md",
      "# Updated live draft\n",
      updatedAnalysis,
    ]);
    expect(updateFileDeferredSpy.mock.calls.at(-1)?.[3]).toEqual(
      expect.objectContaining({
        shouldCancel: expect.any(Function),
      }),
    );
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
      onOpenFolder,
    } = await createHookProps({
      recentFiles: ["notes/recent.md"],
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    const saveAsCommand = getCommand(result.current.commands, "file.save-as");
    const openFolderCommand = getCommand(result.current.commands, "file.open-folder");
    const searchCommand = getCommand(result.current.commands, "nav.search");
    const recentCommand = getCommand(result.current.commands, "file.recent-0");

    saveAsCommand.action();
    overlayHookState.menuHandlers.file_save_as?.();
    getHotkeyHandler("mod+shift+s")();

    expect(editor.saveAs).toHaveBeenCalledTimes(3);

    openFolderCommand.action();
    overlayHookState.menuHandlers.file_open_folder?.();
    expect(onOpenFolder).toHaveBeenCalledTimes(2);

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

  it("loads export implementation from export command actions", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { props, fs } = await createHookProps({
      currentPath: "notes/current.md",
      currentDocText: "# Current\n",
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    expect(exportModuleState.exportDocument).not.toHaveBeenCalled();

    act(() => {
      getCommand(result.current.commands, "export.html").action();
    });

    await vi.waitFor(() => {
      expect(exportModuleState.exportDocument).toHaveBeenCalledWith(
        "# Current\n",
        "html",
        "notes/current.md",
        fs,
      );
    });
    expect(alertSpy).toHaveBeenCalledWith("Exported to notes/current.html");
  });

  it("applies format commands through the Lexical editor handle", async () => {
    const applyChanges = vi.fn();
    const setSelection = vi.fn();
    const focus = vi.fn();
    const handle = {
      applyChanges,
      focus,
      flushPendingEdits: vi.fn(),
      getDoc: vi.fn(() => "alpha beta"),
      getSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      peekDoc: vi.fn(() => "alpha beta"),
      peekSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      insertText: vi.fn(),
      setDoc: vi.fn(),
      setSelection,
    } satisfies MarkdownEditorHandle;
    const { props } = await createHookProps({
      currentDocText: "alpha beta",
      lexicalEditorHandle: handle,
    });

    const { result } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: props,
    });

    act(() => {
      getCommand(result.current.commands, "format.bold").action();
    });

    await vi.waitFor(() => {
      expect(applyChanges).toHaveBeenCalledWith([{
        from: 6,
        to: 10,
        insert: "**beta**",
      }]);
      expect(setSelection).toHaveBeenCalledWith(8, 12);
      expect(focus).toHaveBeenCalledTimes(1);
    });
  });

  it("does not apply a lazy format command to a stale Lexical handle", async () => {
    const staleApplyChanges = vi.fn();
    const staleHandle = {
      applyChanges: staleApplyChanges,
      focus: vi.fn(),
      flushPendingEdits: vi.fn(),
      getDoc: vi.fn(() => "alpha beta"),
      getSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      peekDoc: vi.fn(() => "alpha beta"),
      peekSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      insertText: vi.fn(),
      setDoc: vi.fn(),
      setSelection: vi.fn(),
    } satisfies MarkdownEditorHandle;
    const currentHandle = {
      ...staleHandle,
      applyChanges: vi.fn(),
      getDoc: vi.fn(() => "gamma delta"),
      getSelection: vi.fn(() => ({
        anchor: 6,
        focus: 11,
        from: 6,
        to: 11,
      })),
      peekDoc: vi.fn(() => "gamma delta"),
      peekSelection: vi.fn(() => ({
        anchor: 6,
        focus: 11,
        from: 6,
        to: 11,
      })),
    } satisfies MarkdownEditorHandle;
    const first = await createHookProps({
      currentPath: "a.md",
      currentDocText: "alpha beta",
      lexicalEditorHandle: staleHandle,
    });
    const second = await createHookProps({
      currentPath: "b.md",
      currentDocText: "gamma delta",
      lexicalEditorHandle: currentHandle,
    });

    const { result, rerender } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: first.props,
    });

    act(() => {
      getCommand(result.current.commands, "format.bold").action();
      rerender(second.props);
    });
    await flushAsyncImports();

    expect(staleApplyChanges).not.toHaveBeenCalled();
    expect(currentHandle.applyChanges).not.toHaveBeenCalled();
  });

  it("renames a local label through the hook command flow", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("thm:renamed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const doc = [
      '::: {.theorem #thm:main title="Main Result"}',
      "Body.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n");
    const expectedDoc = [
      '::: {.theorem #thm:renamed title="Main Result"}',
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

    await vi.waitFor(() => {
      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(view.state.doc.toString()).toBe(expectedDoc);
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("does not rename a local label after the active document changes during lazy import", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("thm:renamed");
    const view = createLabelView("::: {.theorem #thm:old}\nOld\n:::\n", 16);
    const first = await createHookProps({
      currentPath: "a.md",
      currentDocText: view.state.doc.toString(),
      view,
    });
    const second = await createHookProps({
      currentPath: "b.md",
      currentDocText: "# Other\n",
      view: null,
    });

    const { result, rerender } = renderHook((hookProps: UseAppOverlaysProps) => useAppOverlays(hookProps), {
      initialProps: first.props,
    });

    act(() => {
      getCommand(result.current.commands, "edit.rename-local-label").action();
      rerender(second.props);
    });
    await flushAsyncImports();

    expect(promptSpy).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("::: {.theorem #thm:old}\nOld\n:::\n");
  });

  it("alerts instead of renaming when the selected label is duplicated", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("dup-renamed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const doc = [
      "# Intro {#dup}",
      "",
      '::: {.theorem #dup title="Duplicate"}',
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

    await vi.waitFor(() => {
      expect(promptSpy).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Local label "dup" is defined more than once in this document. Resolve the duplicate label before renaming it.',
      );
    });
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

    await vi.waitFor(() => {
      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        'Local label "sec:overview" already exists in this document. Choose a different id.',
      );
    });
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

    await vi.waitFor(() => {
      expect(promptSpy).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        "Place the cursor on a local label definition or reference in the current document.",
      );
    });
  });
});
