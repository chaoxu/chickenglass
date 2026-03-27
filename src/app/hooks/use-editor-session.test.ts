import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import { MemoryFileSystem } from "../file-manager";
import { SourceMap } from "../source-map";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";
import type { UseEditorSessionReturn } from "./use-editor-session";

const sessionMockState = vi.hoisted(() => ({
  isTauri: false,
  saveDialog: vi.fn(async () => null as string | null),
  toProjectRelativePath: vi.fn(async (path: string) => path),
  confirmAction: vi.fn(async () => true),
  reset() {
    this.isTauri = false;
    this.saveDialog.mockReset();
    this.saveDialog.mockImplementation(async () => null);
    this.toProjectRelativePath.mockReset();
    this.toProjectRelativePath.mockImplementation(async (path: string) => path);
    this.confirmAction.mockReset();
    this.confirmAction.mockImplementation(async () => true);
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
  isTauri: () => sessionMockState.isTauri,
}));

vi.mock("../tauri-client/fs", () => ({
  toProjectRelativePathCommand: sessionMockState.toProjectRelativePath,
}));

vi.mock("../confirm-action", () => ({
  confirmAction: sessionMockState.confirmAction,
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

function createHybridFileSystem(
  initialFiles: Record<string, string>,
  reads: Record<string, Deferred<string>> = {},
): FileSystem {
  const memory = new MemoryFileSystem(initialFiles);
  return {
    listTree: () => memory.listTree(),
    readFile: (path: string) => {
      const deferred = reads[path];
      if (deferred) {
        return deferred.promise;
      }
      return memory.readFile(path);
    },
    writeFile: (path: string, content: string) => memory.writeFile(path, content),
    createFile: (path: string, content?: string) => memory.createFile(path, content),
    exists: (path: string) => memory.exists(path),
    renameFile: (oldPath: string, newPath: string) => memory.renameFile(oldPath, newPath),
    createDirectory: (path: string) => memory.createDirectory(path),
    deleteFile: (path: string) => memory.deleteFile(path),
    writeFileBinary: (path: string, data: Uint8Array) => memory.writeFileBinary(path, data),
    readFileBinary: (path: string) => memory.readFileBinary(path),
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

  it("invalidates an in-flight openFile when opening an in-memory document", async () => {
    const reads = {
      "a.md": createDeferred<string>(),
    };
    const fs = createAsyncFileSystem(reads);
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));

    let openA!: Promise<void>;
    await act(async () => {
      openA = ref.result.openFile("a.md");
      await Promise.resolve();
    });

    await act(async () => {
      await ref.result.openFileWithContent("scratch.md", "# Scratch");
    });

    expect(ref.result.currentPath).toBe("scratch.md");
    expect(ref.result.editorDoc).toBe("# Scratch");

    await act(async () => {
      reads["a.md"].resolve("# Persisted");
      await openA;
    });

    expect(ref.result.currentPath).toBe("scratch.md");
    expect(ref.result.editorDoc).toBe("# Scratch");
    expect(ref.result.buffers.current.has("a.md")).toBe(false);
  });

  it("cleans up the actual current document after an async open when the path changed mid-flight", async () => {
    const reads = {
      "slow.md": createDeferred<string>(),
    };
    const fs = createHybridFileSystem({
      "current.md": "Current",
      "slow.md": "Slow",
    }, reads);
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("current.md");
    });

    let openSlow!: Promise<void>;
    await act(async () => {
      openSlow = ref.result.openFile("slow.md");
      await Promise.resolve();
    });

    await act(async () => {
      await ref.result.handleRename("current.md", "renamed.md");
    });

    expect(ref.result.currentPath).toBe("renamed.md");
    expect(ref.result.buffers.current.has("renamed.md")).toBe(true);

    await act(async () => {
      reads["slow.md"].resolve("Slow");
      await openSlow;
    });

    expect(ref.result.currentPath).toBe("slow.md");
    expect(ref.result.buffers.current.has("renamed.md")).toBe(false);
    expect(ref.result.liveDocs.current.has("renamed.md")).toBe(false);
  });

  it("saves expanded include edits back to the owning files", async () => {
    const includeRef = [
      "::: {.include}",
      "chapter.md",
      ":::",
    ].join("\n");
    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const rawMain = `${header}${includeRef}${footer}`;
    const expanded = `${header}Old chapter\n${footer}`;
    const edited = `${header}New chapter\n${footer}`;
    const sourceMap = new SourceMap([{
      from: header.length,
      to: header.length + "Old chapter\n".length,
      file: "chapter.md",
      originalRef: includeRef,
      rawFrom: header.length,
      rawTo: header.length + includeRef.length,
      children: [],
    }]);
    const fs = new MemoryFileSystem({
      "main.md": rawMain,
      "chapter.md": "Old chapter\n",
    });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("main.md");
    });

    act(() => {
      ref.result.setDocumentSourceMap("main.md", sourceMap);
      ref.result.handleProgrammaticDocChange("main.md", expanded);
      ref.result.handleDocChange(edited);
    });

    expect(ref.result.currentDocument?.dirty).toBe(true);

    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("New chapter\n");
    expect(ref.result.editorDoc).toBe(edited);
    expect(ref.result.currentDocument?.dirty).toBe(false);
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

  it("confirms before deleting the current file", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    await act(async () => {
      await ref.result.handleDelete("draft.md");
    });

    expect(sessionMockState.confirmAction).toHaveBeenCalledWith(
      "Delete \"draft.md\"? This cannot be undone.",
      { kind: "warning" },
    );
    await expect(fs.exists("draft.md")).resolves.toBe(false);
    expect(ref.result.currentDocument).toBeNull();
    expect(ref.result.editorDoc).toBe("");
  });

  it("keeps the file when deletion is cancelled", async () => {
    sessionMockState.confirmAction.mockResolvedValue(false);
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    await act(async () => {
      await ref.result.handleDelete("draft.md");
    });

    await expect(fs.exists("draft.md")).resolves.toBe(true);
    expect(ref.result.currentPath).toBe("draft.md");
    expect(ref.result.editorDoc).toBe("hello");
  });
});
