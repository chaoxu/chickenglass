import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryFileSystem, type ConditionalWriteResult } from "../file-manager";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { Settings } from "../lib/types";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AutoSaveFlushOptions, AutoSaveFlushReason } from "./use-auto-save";

const shellMockState = vi.hoisted(() => ({
  isTauri: false,
  saveDialog: vi.fn(async () => null as string | null),
  toProjectRelativePath: vi.fn(async (path: string) => path),
  reset() {
    this.isTauri = false;
    this.saveDialog.mockReset();
    this.saveDialog.mockImplementation(async () => null);
    this.toProjectRelativePath.mockReset();
    this.toProjectRelativePath.mockImplementation(async (path: string) => path);
  },
}));

vi.mock("../perf", () => ({
  measureAsync: (_name: string, task: () => Promise<unknown>) => task(),
  withPerfOperation: async (
    _name: string,
    task: (operation: {
      id: string;
      name: string;
      measureAsync: <T>(spanName: string, spanTask: () => Promise<T>) => Promise<T>;
      measureSync: <T>(spanName: string, spanTask: () => T) => T;
      end: () => void;
    }) => Promise<unknown>,
  ) => task({
    id: "test-operation",
    name: "test-operation",
    measureAsync: async (_spanName, spanTask) => spanTask(),
    measureSync: (_spanName, spanTask) => spanTask(),
    end: () => {},
  }),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => shellMockState.isTauri,
}));

vi.mock("../tauri-client/fs", () => ({
  toProjectRelativePathCommand: shellMockState.toProjectRelativePath,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: shellMockState.saveDialog,
}));

const { useAppEditorShell } = await import("./use-app-editor-shell");

interface HarnessRef {
  result: AppEditorShellController;
}

interface HarnessOptions {
  files?: Record<string, string>;
  flushPendingAutoSave?: (
    reason: AutoSaveFlushReason,
    options?: AutoSaveFlushOptions,
  ) => Promise<void>;
  flushPendingHotExitBackup?: () => Promise<void>;
  onAfterSave?: (path: string) => void | Promise<void>;
  requestUnsavedChangesDecision?: () => Promise<"save" | "discard" | "cancel">;
  settings?: Partial<Settings>;
}

function createHarness(
  options: HarnessOptions = {},
): { Harness: FC; fs: MemoryFileSystem; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as AppEditorShellController,
  };

  const settings: Settings = {
    autoSaveInterval: 30000,
    fontSize: 16,
    lineHeight: 1.6,
    tabSize: 2,
    showLineNumbers: false,
    wordWrap: true,
    editorMode: "cm6-rich",
    theme: "system",
    defaultExportFormat: "pdf",
    enabledPlugins: {},
    themeName: "default",
    writingTheme: "academic",
    customCss: "",
    skipDirtyConfirm: false,
    ...options.settings,
  };

  const fs = new MemoryFileSystem(options.files ?? {});

  const Harness: FC = () => {
    ref.result = useAppEditorShell({
      fs,
      settings,
      refreshTree: async () => {},
      addRecentFile: () => {},
      onAfterSave: options.onAfterSave,
      flushPendingAutoSave: options.flushPendingAutoSave,
      flushPendingHotExitBackup: options.flushPendingHotExitBackup,
      requestUnsavedChangesDecision:
        options.requestUnsavedChangesDecision ?? (async () => "discard"),
    });
    return null;
  };

  return { Harness, fs, ref };
}

function replaceCurrentDoc(
  ref: HarnessRef,
  nextDoc: string,
): readonly EditorDocumentChange[] {
  const currentDoc = ref.result.getCurrentDocText();
  return [{ from: 0, to: currentDoc.length, insert: nextDoc }];
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("useAppEditorShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    shellMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("delegates navigation handlers from useEditorNavigation", () => {
    const { Harness, ref } = createHarness();

    act(() => root.render(createElement(Harness)));

    expect(ref.result.handleOutlineSelect).toBeTypeOf("function");
    expect(ref.result.handleGotoLine).toBeTypeOf("function");
    expect(ref.result.handleSearchResult).toBeTypeOf("function");
    expect(ref.result.handleEditorDocumentReady).toBeTypeOf("function");
  });

  it("uses the saved editor mode as the default for markdown files", async () => {
    const { Harness, ref } = createHarness({
      files: {
        "notes.md": "# Notes\n",
      },
      settings: {
        editorMode: "source",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("notes.md");
    });

    expect(ref.result.editorMode).toBe("source");
  });

  it("preserves the current file mode when search navigation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { Harness, ref } = createHarness({
      files: {
        "notes.md": "# Notes\n",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("notes.md");
    });

    act(() => {
      ref.result.handleModeChange("source");
    });

    expect(ref.result.editorMode).toBe("source");

    act(() => {
      ref.result.handleSearchResult({
        file: "missing.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ref.result.currentPath).toBe("notes.md");
    expect(ref.result.editorMode).toBe("source");

    errorSpy.mockRestore();
  });

  it("applies the requested mode after cross-file search navigation opens the target", async () => {
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleSearchResult({
        file: "b.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await vi.waitFor(() => {
      expect(ref.result.currentPath).toBe("b.md");
      expect(ref.result.editorMode).toBe("source");
    });
  });

  it("flushes pending autosave before switching files", async () => {
    const flushPendingAutoSave = vi.fn(async () => {});
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      flushPendingAutoSave,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed\n"));
    });

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(flushPendingAutoSave).toHaveBeenCalledWith("navigation", { force: true });
    expect(ref.result.currentPath).toBe("b.md");
  });

  it("tracks in-flight and completed saves", async () => {
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
    });
    const writeGate = createDeferred<void>();
    const originalWrite = fs.writeFileIfUnchanged.bind(fs);
    vi.spyOn(fs, "writeFileIfUnchanged").mockImplementation(async (
      path: string,
      content: string,
      expectedHash: string,
    ): Promise<ConditionalWriteResult> => {
      await writeGate.promise;
      return originalWrite(path, content, expectedHash);
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed\n"));
    });

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = ref.result.saveFile();
    });

    await vi.waitFor(() => {
      expect(ref.result.saveActivity.status).toBe("saving");
    });

    writeGate.resolve();
    await act(async () => {
      await savePromise;
    });

    expect(ref.result.saveActivity.status).toBe("idle");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("emits the internal save notification after saving coflat.yaml", async () => {
    const onAfterSave = vi.fn();
    const { Harness, ref } = createHarness({
      files: {
        "coflat.yaml": "bibliography: old.bib\n",
      },
      onAfterSave,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("coflat.yaml");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "bibliography: new.bib\n"));
    });

    await act(async () => {
      await ref.result.saveFile();
    });

    expect(onAfterSave).toHaveBeenCalledWith("coflat.yaml");
  });

  it("surfaces save failures until the next edit", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const saveError = new Error("disk full");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
    });
    vi.spyOn(fs, "writeFileIfUnchanged").mockRejectedValue(saveError);

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed\n"));
    });

    await act(async () => {
      await expect(ref.result.saveFile()).rejects.toThrow("disk full");
    });

    expect(ref.result.saveActivity).toEqual({
      status: "failed",
      message: "disk full",
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed again\n"));
    });

    expect(ref.result.saveActivity.status).toBe("idle");
    consoleError.mockRestore();
  });

  it("surfaces Save As project-root failures until the next edit", async () => {
    shellMockState.isTauri = true;
    shellMockState.saveDialog.mockResolvedValue("/tmp/outside.md");
    shellMockState.toProjectRelativePath.mockRejectedValue(
      new Error("Path '/tmp/outside.md' escapes project root"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    await act(async () => {
      await expect(ref.result.saveAs()).rejects.toThrow("escapes project root");
    });

    expect(ref.result.saveActivity).toEqual({
      status: "failed",
      message: "Save As can only save inside the current project folder. Choose a location inside the open project.",
    });
    expect(ref.result.currentPath).toBe("a.md");
    await expect(fs.readFile("a.md")).resolves.toBe("# A\n");

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed\n"));
    });

    expect(ref.result.saveActivity.status).toBe("idle");
    consoleError.mockRestore();
  });

  it("does not force autosave before switching files when autosave is off", async () => {
    const flushPendingAutoSave = vi.fn(async () => {});
    const flushPendingHotExitBackup = vi.fn(async () => {});
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("cancel");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      flushPendingAutoSave,
      flushPendingHotExitBackup,
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(flushPendingAutoSave).not.toHaveBeenCalled();
    expect(flushPendingHotExitBackup).toHaveBeenCalledTimes(1);
    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    expect(ref.result.currentPath).toBe("a.md");
    await expect(fs.readFile("a.md")).resolves.toBe("# A\n");
  });

  it("discards dirty edits before switching files when autosave is off", async () => {
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("discard");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    expect(ref.result.currentPath).toBe("b.md");
    await expect(fs.readFile("a.md")).resolves.toBe("# A\n");
  });

  it("stays on the dirty file when save-before-switch hits a write conflict", async () => {
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("save");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    await fs.writeFile("a.md", "# A external\n");

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    expect(ref.result.currentPath).toBe("a.md");
    expect(ref.result.isPathDirty("a.md")).toBe(true);
    await expect(fs.readFile("a.md")).resolves.toBe("# A external\n");
  });

  it("prompts before opening dropped content when autosave is off", async () => {
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("cancel");
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.openFileWithContent("scratch.md", "# Scratch\n");
    });

    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    expect(ref.result.currentPath).toBe("a.md");
    expect(ref.result.getCurrentDocText()).toBe("# A draft\n");
  });

  it("does not force autosave before closing a dirty file when autosave is off", async () => {
    const flushPendingAutoSave = vi.fn(async () => {});
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("cancel");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
      flushPendingAutoSave,
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.closeCurrentFile();
    });

    expect(flushPendingAutoSave).not.toHaveBeenCalled();
    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    expect(ref.result.currentPath).toBe("a.md");
    await expect(fs.readFile("a.md")).resolves.toBe("# A\n");
  });

  it("does not force autosave before window close when autosave is off", async () => {
    const flushPendingAutoSave = vi.fn(async () => {});
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("cancel");
    const { Harness, fs, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
      flushPendingAutoSave,
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    let canClose = true;
    await act(async () => {
      canClose = await ref.result.handleWindowCloseRequest();
    });

    expect(canClose).toBe(false);
    expect(flushPendingAutoSave).not.toHaveBeenCalled();
    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    await expect(fs.readFile("a.md")).resolves.toBe("# A\n");
  });

  it("flushes hot-exit backup before window close even when autosave is off", async () => {
    const flushPendingAutoSave = vi.fn(async () => {});
    const flushPendingHotExitBackup = vi.fn(async () => {});
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("cancel");
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
      },
      flushPendingAutoSave,
      flushPendingHotExitBackup,
      requestUnsavedChangesDecision,
      settings: { autoSaveInterval: 0 },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A draft\n"));
    });

    await act(async () => {
      await ref.result.handleWindowCloseRequest();
    });

    expect(flushPendingHotExitBackup).toHaveBeenCalledTimes(1);
    expect(flushPendingAutoSave).not.toHaveBeenCalled();
  });

  it("does not persist a target mode override when search navigation is canceled", async () => {
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("discard");
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      requestUnsavedChangesDecision,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleModeChange("source");
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# A changed\n"));
    });

    requestUnsavedChangesDecision.mockResolvedValueOnce("cancel");

    act(() => {
      ref.result.handleSearchResult({
        file: "b.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await vi.waitFor(() => {
      expect(ref.result.currentPath).toBe("a.md");
      expect(ref.result.editorMode).toBe("source");
    });

    requestUnsavedChangesDecision.mockResolvedValueOnce("discard");

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(ref.result.currentPath).toBe("b.md");
    expect(ref.result.editorMode).toBe("cm6-rich");
  });

});
