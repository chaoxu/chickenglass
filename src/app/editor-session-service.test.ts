import { describe, expect, it, vi } from "vitest";

import { createMinimalEditorDocumentChanges } from "../lib/editor-doc-change";
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
    runtime,
  });
  runtime.setWriteDocumentSnapshot(persistence.writeDocumentSnapshot);
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

const includeRef = [
  "::: {.include}",
  "chapter.md",
  ":::",
].join("\n");

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

  it("does not switch documents when openFileWithContent cannot create its backing file", async () => {
    const fs = createHybridFileSystem({ "current.md": "Current" });
    fs.createFile = async () => {
      throw new Error("create denied");
    };
    const { runtime, service } = createSessionHarness(fs);

    await service.openFile("current.md");
    await expect(service.openFileWithContent("scratch.md", "# Scratch")).rejects.toThrow(
      "create denied",
    );

    expect(runtime.getCurrentPath()).toBe("current.md");
    expect(runtime.getEditorDoc()).toBe("Current");
    expect(runtime.hasPath("scratch.md")).toBe(false);
  });

  it("opens new synthetic content as a clean backed document", async () => {
    const fs = createHybridFileSystem({});
    const { runtime, service } = createSessionHarness(fs);

    await service.openFileWithContent("scratch.md", "# Scratch");

    expect(runtime.getCurrentPath()).toBe("scratch.md");
    expect(runtime.getCurrentDocument()?.dirty).toBe(false);
    expect(runtime.getEditorDoc()).toBe("# Scratch");
    expect(runtime.pipeline.isSelfChange("scratch.md", "# Scratch")).toBe(true);
    await expect(fs.readFile("scratch.md")).resolves.toBe("# Scratch");
  });

  it("opens synthetic content over an existing backing path as dirty", async () => {
    const fs = createHybridFileSystem({ "scratch.md": "Existing" });
    const { runtime, service } = createSessionHarness(fs);

    await service.openFileWithContent("scratch.md", "# Scratch");

    expect(runtime.getCurrentPath()).toBe("scratch.md");
    expect(runtime.getCurrentDocument()?.dirty).toBe(true);
    expect(runtime.getEditorDoc()).toBe("# Scratch");
    await expect(fs.readFile("scratch.md")).resolves.toBe("Existing");
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

  it("keeps projected include saves correct after edits before include regions", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End\n";
    const chapter = "Chapter body\n";
    const inserted = "Preface\n";
    const editedHeader = "# Main\nPreface\n\n";
    const fs = new MemoryFileSystem({
      "main.md": `${header}${includeRef}${footer}`,
      "chapter.md": chapter,
    });
    const { persistence, service } = createSessionHarness(fs);

    await service.openFile("main.md");
    const previousDoc = service.getCurrentDocText();
    const nextDoc = previousDoc.replace("\n\n", `\n${inserted}\n`);
    service.handleDocChange(createMinimalEditorDocumentChanges(previousDoc, nextDoc));

    const [chapterRegion] = service.getCurrentSourceMap()?.regions ?? [];
    expect(chapterRegion?.from).toBe(editedHeader.length);
    expect(chapterRegion?.to).toBe((editedHeader + chapter).length);

    await persistence.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(`${editedHeader}${includeRef}${footer}`);
    await expect(fs.readFile("chapter.md")).resolves.toBe(chapter);
  });

  it("keeps projected include saves correct after edits inside include regions", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End\n";
    const chapter = "Chapter body\n";
    const editedChapter = "Revised chapter body\n";
    const fs = new MemoryFileSystem({
      "main.md": `${header}${includeRef}${footer}`,
      "chapter.md": chapter,
    });
    const { persistence, service } = createSessionHarness(fs);

    await service.openFile("main.md");
    const previousDoc = service.getCurrentDocText();
    const nextDoc = `${header}${editedChapter}${footer}`;
    service.handleDocChange(createMinimalEditorDocumentChanges(previousDoc, nextDoc));

    const [chapterRegion] = service.getCurrentSourceMap()?.regions ?? [];
    expect(chapterRegion?.from).toBe(header.length);
    expect(chapterRegion?.to).toBe((header + editedChapter).length);

    await persistence.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(`${header}${includeRef}${footer}`);
    await expect(fs.readFile("chapter.md")).resolves.toBe(editedChapter);
  });

  it("drops projection when an edit crosses an include boundary", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End\n";
    const chapter = "Chapter body\n";
    const fs = new MemoryFileSystem({
      "main.md": `${header}${includeRef}${footer}`,
      "chapter.md": chapter,
    });
    const { persistence, service } = createSessionHarness(fs);

    await service.openFile("main.md");
    const previousDoc = service.getCurrentDocText();
    const nextDoc = previousDoc.replace("\n\nChapter", "\nCross-boundary");
    service.handleDocChange(createMinimalEditorDocumentChanges(previousDoc, nextDoc));

    expect(service.getCurrentSourceMap()).toBeNull();

    await persistence.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(nextDoc);
    await expect(fs.readFile("chapter.md")).resolves.toBe(chapter);
  });

  it("drops projection for insertions at include boundaries instead of guessing ownership", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End\n";
    const chapter = "Chapter body\n";
    const fs = new MemoryFileSystem({
      "main.md": `${header}${includeRef}${footer}`,
      "chapter.md": chapter,
    });
    const { persistence, service } = createSessionHarness(fs);

    await service.openFile("main.md");
    const previousDoc = service.getCurrentDocText();
    const nextDoc = `${header}Boundary insertion\n${chapter}${footer}`;
    service.handleDocChange(createMinimalEditorDocumentChanges(previousDoc, nextDoc));

    expect(service.getCurrentSourceMap()).toBeNull();

    await persistence.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(nextDoc);
    await expect(fs.readFile("chapter.md")).resolves.toBe(chapter);
  });

  it("drops projection for insertions at include end boundaries", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End\n";
    const chapter = "Chapter body\n";
    const fs = new MemoryFileSystem({
      "main.md": `${header}${includeRef}${footer}`,
      "chapter.md": chapter,
    });
    const { persistence, service } = createSessionHarness(fs);

    await service.openFile("main.md");
    const previousDoc = service.getCurrentDocText();
    const nextDoc = `${header}${chapter}Boundary insertion\n${footer}`;
    service.handleDocChange(createMinimalEditorDocumentChanges(previousDoc, nextDoc));

    expect(service.getCurrentSourceMap()).toBeNull();

    await persistence.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(nextDoc);
    await expect(fs.readFile("chapter.md")).resolves.toBe(chapter);
  });
});
