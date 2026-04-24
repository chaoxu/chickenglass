import { describe, expect, it, vi } from "vitest";

import type { FileSystem } from "./file-manager";
import { MemoryFileSystem } from "./file-manager";
import { createEditorSessionPersistence } from "./editor-session-persistence";
import { createEditorSessionRuntime } from "./editor-session-runtime";
import { createEditorSessionService } from "./editor-session-service";

vi.mock("./perf", () => ({
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

function createSessionHarness(fs: FileSystem) {
  const runtime = createEditorSessionRuntime();
  const persistence = createEditorSessionPersistence({
    fs,
    refreshTree: async () => {},
    addRecentFile: () => {},
    requestUnsavedChangesDecision: async () => "discard",
    runtime,
  });
  runtime.setWriteDocumentSnapshot((path, snapshot) =>
    persistence.writeDocumentSnapshot(path, snapshot.content, {
      createTargetIfMissing: snapshot.createTargetIfMissing,
      expectedBaselineHash: snapshot.expectedBaselineHash,
    }),
  );
  const service = createEditorSessionService({
    fs,
    refreshTree: async () => {},
    addRecentFile: () => {},
    requestUnsavedChangesDecision: async () => "discard",
    runtime,
    saveCurrentDocument: persistence.saveCurrentDocument,
  });

  return {
    runtime,
    persistence,
    service,
  };
}

describe("editor session lower-layer invariants", () => {
  it("drops stale async file data when an in-memory document wins the race", async () => {
    const reads = {
      "a.md": createDeferred<string>(),
    };
    const { runtime, service } = createSessionHarness(createAsyncFileSystem(reads));

    const openA = service.openFile("a.md");
    await Promise.resolve();
    await service.openFileWithContent("scratch.md", "# Scratch");

    reads["a.md"].resolve("# Persisted");
    await openA;

    expect(runtime.getCurrentPath()).toBe("scratch.md");
    expect(runtime.getEditorDoc()).toBe("# Scratch");
    expect(runtime.buffers.has("a.md")).toBe(false);
    expect(runtime.liveDocs.has("a.md")).toBe(false);
  });

  it("cleans up renamed path state when a later async open replaces the current document", async () => {
    const reads = {
      "slow.md": createDeferred<string>(),
    };
    const fs = createHybridFileSystem({
      "current.md": "Current",
      "slow.md": "Slow",
    }, reads);
    const { runtime, persistence, service } = createSessionHarness(fs);

    await service.openFile("current.md");

    const openSlow = service.openFile("slow.md");
    await Promise.resolve();

    await persistence.handleRename("current.md", "renamed.md");
    expect(runtime.getCurrentPath()).toBe("renamed.md");
    expect(runtime.buffers.has("renamed.md")).toBe(true);

    reads["slow.md"].resolve("Slow");
    await openSlow;

    expect(runtime.getCurrentPath()).toBe("slow.md");
    expect(runtime.getEditorDoc()).toBe("Slow");
    expect(runtime.buffers.has("renamed.md")).toBe(false);
    expect(runtime.liveDocs.has("renamed.md")).toBe(false);
  });

  it("keeps a clean active document as a dirty recovery buffer when it is deleted externally", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "Recovered text" });
    const { runtime, service } = createSessionHarness(fs);

    await service.openFile("draft.md");
    await fs.deleteFile("draft.md");

    await expect(service.syncExternalChange("draft.md")).resolves.toBe("ignore");

    expect(runtime.getCurrentDocument()).toEqual({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(runtime.getEditorDoc()).toBe("Recovered text");
    expect(service.getCurrentDocText()).toBe("Recovered text");
  });

  it("keeps a clean active descendant as a dirty recovery buffer when its folder is removed externally", async () => {
    const fs = new MemoryFileSystem({ "notes/draft.md": "Nested text" });
    const { runtime, service } = createSessionHarness(fs);

    await service.openFile("notes/draft.md");
    await fs.deleteFile("notes");

    await expect(service.syncExternalChange("notes")).resolves.toBe("ignore");

    expect(runtime.getCurrentDocument()).toEqual({
      path: "notes/draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(runtime.getEditorDoc()).toBe("Nested text");
    expect(service.getCurrentDocText()).toBe("Nested text");
  });

  it("ignores ancestor watcher reads when the clean active descendant still exists", async () => {
    const fs = new MemoryFileSystem({ "notes/draft.md": "Nested text" });
    const { runtime, service } = createSessionHarness(fs);

    await service.openFile("notes/draft.md");

    await expect(service.syncExternalChange("notes")).resolves.toBe("ignore");

    expect(runtime.getCurrentDocument()).toEqual({
      path: "notes/draft.md",
      name: "draft.md",
      dirty: false,
    });
    expect(runtime.getEditorDoc()).toBe("Nested text");
  });

  it("opens generated content at a filesystem-unique path", async () => {
    const fs = new MemoryFileSystem({ "main.md": "# Existing" });
    const { runtime, persistence, service } = createSessionHarness(fs);

    await service.openFileWithContent("main.md", "# Generated");

    expect(runtime.getCurrentDocument()).toEqual({
      path: "main (1).md",
      name: "main (1).md",
      dirty: true,
    });

    await expect(persistence.saveCurrentDocument()).resolves.toBe(true);
    await expect(fs.readFile("main.md")).resolves.toBe("# Existing");
    await expect(fs.readFile("main (1).md")).resolves.toBe("# Generated");
  });

  it("surfaces a conflict instead of overwriting when a generated target appears before save", async () => {
    const fs = new MemoryFileSystem();
    const { runtime, persistence, service } = createSessionHarness(fs);

    await service.openFileWithContent("scratch.md", "# Generated");
    await fs.createFile("scratch.md", "# Existing");

    await expect(persistence.saveCurrentDocument()).resolves.toBe(false);

    await expect(fs.readFile("scratch.md")).resolves.toBe("# Existing");
    expect(runtime.getState().externalConflict).toEqual({
      kind: "modified",
      path: "scratch.md",
    });
    expect(runtime.newDocumentPaths.has("scratch.md")).toBe(false);
    expect(runtime.externalConflictBaselines.has("scratch.md")).toBe(true);
  });
});
