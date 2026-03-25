import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import { MemoryFileSystem } from "../file-manager";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";
import type { UseEditorSessionReturn } from "./use-editor-session";

const sessionMockState = vi.hoisted(() => ({
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

vi.mock("../tauri-fs", () => ({
  isTauri: () => sessionMockState.isTauri,
}));

vi.mock("../tauri-client/fs", () => ({
  toProjectRelativePathCommand: sessionMockState.toProjectRelativePath,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: sessionMockState.saveDialog,
}));

const { useEditorSession } = await import("./use-editor-session");

interface HarnessRef {
  result: UseEditorSessionReturn;
}

function createHarness(
  fs: FileSystem,
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision> = async () => "discard",
): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as UseEditorSessionReturn,
  };

  const Harness: FC = () => {
    ref.result = useEditorSession({
      fs,
      refreshTree: async () => {},
      addRecentFile: () => {},
      requestUnsavedChangesDecision,
    });
    return null;
  };

  return { Harness, ref };
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

describe("useEditorSession", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps editorDoc and dirty state in sync while typing", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.currentDocument?.dirty).toBe(false);

    act(() => {
      ref.result.handleDocChange("hello!");
    });

    expect(ref.result.editorDoc).toBe("hello!");
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.liveDocs.current.get("draft.md")).toBe("hello!");
  });

  it("ignores stale openFile reads when a newer request wins", async () => {
    const reads = {
      "a.md": createDeferred<string>(),
      "b.md": createDeferred<string>(),
    };
    const fs = createAsyncFileSystem(reads);
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));

    let openA!: Promise<void>;
    let openB!: Promise<void>;
    await act(async () => {
      openA = ref.result.openFile("a.md");
      openB = ref.result.openFile("b.md");
      await Promise.resolve();
    });

    await act(async () => {
      reads["b.md"].resolve("B");
      await openB;
    });

    expect(ref.result.currentPath).toBe("b.md");
    expect(ref.result.currentDocument).toEqual({
      path: "b.md",
      name: "b.md",
      dirty: false,
    });
    expect(ref.result.editorDoc).toBe("B");

    await act(async () => {
      reads["a.md"].resolve("A");
      await openA;
    });

    expect(ref.result.currentPath).toBe("b.md");
    expect(ref.result.currentDocument).toEqual({
      path: "b.md",
      name: "b.md",
      dirty: false,
    });
    expect(ref.result.editorDoc).toBe("B");
  });

  it("cancels file switching when the unsaved-changes prompt says cancel", async () => {
    const fs = new MemoryFileSystem({
      "draft.md": "hello",
      "other.md": "world",
    });
    const requestUnsavedChangesDecision = vi.fn<
      (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>
    >(async () => "cancel");
    const { Harness, ref } = createHarness(fs, requestUnsavedChangesDecision);

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange("hello!");
    });

    await act(async () => {
      await ref.result.openFile("other.md");
    });

    expect(requestUnsavedChangesDecision).toHaveBeenCalledWith({
      reason: "switch-file",
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
      },
      target: {
        path: "other.md",
        name: "other.md",
      },
    });
    expect(ref.result.currentPath).toBe("draft.md");
    expect(ref.result.editorDoc).toBe("hello!");
    expect(ref.result.currentDocument?.dirty).toBe(true);
  });

  it("rejects real save-as failures instead of treating them like cancel", async () => {
    sessionMockState.isTauri = true;
    sessionMockState.saveDialog.mockResolvedValue("/tmp/renamed.md");
    sessionMockState.toProjectRelativePath.mockRejectedValue(new Error("outside project"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    await expect(ref.result.saveAs()).rejects.toThrow("outside project");
    expect(consoleError).toHaveBeenCalledWith("[session] save-as failed:", expect.any(Error));
    consoleError.mockRestore();
  });
});
