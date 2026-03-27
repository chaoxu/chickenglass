import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryFileSystem, type FileSystem } from "../file-manager";
import type { Settings } from "../lib/types";
import type { AppEditorShellController } from "./use-app-editor-shell";

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

const { useAppEditorShell } = await import("./use-app-editor-shell");

interface HarnessRef {
  result: AppEditorShellController;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createAsyncFileSystem(reads: Record<string, Deferred<string>>): FileSystem {
  return {
    listTree: async () => ({ name: "root", path: "", isDirectory: true, children: [] }),
    readFile: (path: string) => {
      const deferred = reads[path];
      if (!deferred) {
        throw new Error(`unexpected read for ${path}`);
      }
      return deferred.promise;
    },
    writeFile: async () => {},
    createFile: async () => {},
    exists: async () => false,
    renameFile: async () => {},
    createDirectory: async () => {},
    deleteFile: async () => {},
    writeFileBinary: async () => {},
    readFileBinary: async () => new Uint8Array(),
  };
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
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

  const Harness: FC = () => {
    ref.result = useAppEditorShell({
      fs,
      settings,
      refreshTree: async () => {},
      addRecentFile: () => {},
      requestUnsavedChangesDecision: async () => "discard",
    });
    return null;
  };

  return { Harness, ref };
}

function createFakeView(): {
  view: EditorView;
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const focus = vi.fn();
  return {
    view: {
      dispatch,
      focus,
    } as unknown as EditorView,
    dispatch,
    focus,
  };
}

describe("useAppEditorShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("waits for an explicit editor-ready signal before navigating to a search result", async () => {
    const fs = new MemoryFileSystem({ "notes.md": "# Notes" });
    const { Harness, ref } = createHarness(fs);
    const onComplete = vi.fn();
    const fakeView = createFakeView();

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      ref.result.handleSearchResult("notes.md", 4, onComplete);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeView.dispatch).not.toHaveBeenCalled();
    expect(fakeView.focus).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      ref.result.handleEditorDocumentReady(fakeView.view, "notes.md");
      await Promise.resolve();
    });

    expect(fakeView.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 4 },
      scrollIntoView: true,
    });
    expect(fakeView.focus).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("skips stale search-result navigation when a newer open request wins", async () => {
    const reads = {
      "a.md": createDeferred<string>(),
      "b.md": createDeferred<string>(),
    };
    const fs = createAsyncFileSystem(reads);
    const { Harness, ref } = createHarness(fs);
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const staleView = createFakeView();
    const currentView = createFakeView();

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      ref.result.handleSearchResult("a.md", 1, onCompleteA);
      ref.result.handleSearchResult("b.md", 2, onCompleteB);
      await Promise.resolve();
    });

    await act(async () => {
      reads["b.md"].resolve("# B");
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      ref.result.handleEditorDocumentReady(currentView.view, "b.md");
      await Promise.resolve();
    });

    await act(async () => {
      reads["a.md"].resolve("# A");
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      ref.result.handleEditorDocumentReady(staleView.view, "a.md");
      await Promise.resolve();
    });

    expect(currentView.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 2 },
      scrollIntoView: true,
    });
    expect(currentView.focus).toHaveBeenCalledOnce();
    expect(onCompleteB).toHaveBeenCalledOnce();

    expect(staleView.dispatch).not.toHaveBeenCalled();
    expect(staleView.focus).not.toHaveBeenCalled();
    expect(onCompleteA).toHaveBeenCalledOnce();
  });
});
