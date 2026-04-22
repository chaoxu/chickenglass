import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditorDocumentText,
  type EditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "./editor-doc-change";
import { markSessionDocumentDirty } from "./editor-session-actions";
import { createEditorSessionState, type SessionDocument } from "./editor-session-model";
import {
  createEditorSessionPersistence,
  type EditorSessionPersistence,
} from "./editor-session-persistence";
import { createEditorSessionRuntime, type EditorSessionRuntime } from "./editor-session-runtime";
import type { FileSystem } from "./file-manager";
import { MemoryFileSystem } from "./file-manager";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "./unsaved-changes";

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

vi.mock("./perf", () => ({
  measureAsync: (_name: string, task: () => Promise<unknown>) => task(),
}));

vi.mock("../lib/tauri", () => ({
  isTauri: () => sessionMockState.isTauri,
}));

vi.mock("./tauri-client/fs", () => ({
  toProjectRelativePathCommand: sessionMockState.toProjectRelativePath,
}));

vi.mock("./confirm-action", () => ({
  confirmAction: sessionMockState.confirmAction,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: sessionMockState.saveDialog,
}));

interface HarnessRef {
  result: EditorSessionPersistence;
  runtime: EditorSessionRuntime;
}

interface HarnessOptions {
  fs: FileSystem;
  currentDocument: SessionDocument | null;
  editorDoc: string;
  buffers: Map<string, EditorDocumentText>;
  liveDocs: Map<string, EditorDocumentText>;
  refreshTree?: () => Promise<void>;
  addRecentFile?: (path: string) => void;
  onAfterPathRemoved?: (path: string) => void | Promise<void>;
  onAfterSave?: (path: string) => void | Promise<void>;
  requestUnsavedChangesDecision?: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

function createHarness({
  fs,
  currentDocument,
  editorDoc,
  buffers: initialBuffers,
  liveDocs: initialLiveDocs,
  refreshTree = async () => {},
  addRecentFile = () => {},
  onAfterPathRemoved,
  onAfterSave,
  requestUnsavedChangesDecision = async () => "discard",
}: HarnessOptions): HarnessRef {
  const runtime = createEditorSessionRuntime();
  runtime.commit(createEditorSessionState(currentDocument), { editorDoc });
  for (const [path, doc] of initialBuffers) {
    runtime.buffers.set(path, doc);
  }
  for (const [path, doc] of initialLiveDocs) {
    runtime.liveDocs.set(path, doc);
  }

  let result!: EditorSessionPersistence;
  runtime.setWriteDocumentSnapshot((path, snapshot) =>
    result.writeDocumentSnapshot(path, snapshot.content, {
      expectedBaselineHash: snapshot.expectedBaselineHash,
    }),
  );

  result = createEditorSessionPersistence({
    fs,
    refreshTree,
    addRecentFile,
    onAfterPathRemoved,
    onAfterSave,
    requestUnsavedChangesDecision,
    runtime,
  });

  return {
    result,
    runtime,
  };
}

function createDocumentMap(entries: Record<string, string>): Map<string, EditorDocumentText> {
  return new Map(
    Object.entries(entries).map(([path, doc]) => [path, createEditorDocumentText(doc)]),
  );
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function createDirectoryRenameFileSystem(initialFiles: Record<string, string>): FileSystem {
  const files = new Map(Object.entries(initialFiles));
  const remapPath = (path: string, oldPath: string, newPath: string): string | null => {
    if (path === oldPath) return newPath;
    if (oldPath !== "" && path.startsWith(`${oldPath}/`)) {
      return `${newPath}/${path.slice(oldPath.length + 1)}`;
    }
    return null;
  };

  return {
    listTree: async () => ({ name: "root", path: "", isDirectory: true, children: [] }),
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    },
    writeFile: async (path: string, content: string) => {
      if (!files.has(path)) {
        throw new Error(`File not found: ${path}`);
      }
      files.set(path, content);
    },
    createFile: async (path: string, content?: string) => {
      files.set(path, content ?? "");
    },
    exists: async (path: string) => {
      if (files.has(path)) return true;
      const prefix = `${path}/`;
      return [...files.keys()].some((candidate) => candidate.startsWith(prefix));
    },
    renameFile: async (oldPath: string, newPath: string) => {
      const renamedEntries = [...files.entries()]
        .map(([path, content]) => {
          const remapped = remapPath(path, oldPath, newPath);
          return remapped ? { oldPath: path, newPath: remapped, content } : null;
        })
        .filter((entry): entry is { oldPath: string; newPath: string; content: string } =>
          entry !== null,
        );

      if (renamedEntries.length === 0) {
        throw new Error(`File not found: ${oldPath}`);
      }

      for (const entry of renamedEntries) {
        files.delete(entry.oldPath);
      }
      for (const entry of renamedEntries) {
        files.set(entry.newPath, entry.content);
      }
    },
    createDirectory: async () => {},
    deleteFile: async (path: string) => {
      if (files.delete(path)) return;
      const prefix = `${path}/`;
      const descendants = [...files.keys()].filter((candidate) =>
        candidate.startsWith(prefix),
      );
      if (descendants.length === 0) {
        throw new Error(`File not found: ${path}`);
      }
      for (const descendant of descendants) {
        files.delete(descendant);
      }
    },
    writeFileBinary: async () => {},
    readFileBinary: async () => new Uint8Array(),
  };
}

describe("createEditorSessionPersistence", () => {
  beforeEach(() => {
    sessionMockState.reset();
  });

  it("saves the active document only and clears dirty state", async () => {
    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const rawMain = `${header}Old chapter\n${footer}`;
    const edited = `${header}New chapter\n${footer}`;
    const fs = new MemoryFileSystem({
      "main.md": rawMain,
      "chapter.md": "Old chapter\n",
    });
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: edited,
      buffers: createDocumentMap({ "main.md": rawMain }),
      liveDocs: createDocumentMap({ "main.md": edited }),
    });

    await ref.result.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(edited);
    await expect(fs.readFile("chapter.md")).resolves.toBe("Old chapter\n");
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(false);
    expect(ref.runtime.getEditorDoc()).toBe(edited);
    expect(editorDocumentToString(ref.runtime.buffers.get("main.md") ?? emptyEditorDocument)).toBe(edited);
    expect(editorDocumentToString(ref.runtime.liveDocs.get("main.md") ?? emptyEditorDocument)).toBe(edited);
  });

  it("blocks saving when disk changed after the editor baseline", async () => {
    const fs = new MemoryFileSystem({ "main.md": "saved" });
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: "local edit",
      buffers: createDocumentMap({ "main.md": "saved" }),
      liveDocs: createDocumentMap({ "main.md": "local edit" }),
    });
    await fs.writeFile("main.md", "external edit");

    await expect(ref.result.saveCurrentDocument()).resolves.toBe(false);

    await expect(fs.readFile("main.md")).resolves.toBe("external edit");
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(true);
    expect(ref.runtime.getState().externalConflict).toEqual({
      kind: "modified",
      path: "main.md",
    });
  });

  it("blocks saving when disk changes during the conditional write", async () => {
    const fs = new MemoryFileSystem({ "main.md": "saved" });
    const writeIfUnchanged = fs.writeFileIfUnchanged.bind(fs);
    vi.spyOn(fs, "writeFileIfUnchanged").mockImplementationOnce(
      async (path, content, expectedHash) => {
        await fs.writeFile(path, "external after save started");
        return writeIfUnchanged(path, content, expectedHash);
      },
    );
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: "local edit",
      buffers: createDocumentMap({ "main.md": "saved" }),
      liveDocs: createDocumentMap({ "main.md": "local edit" }),
    });

    await expect(ref.result.saveCurrentDocument()).resolves.toBe(false);

    await expect(fs.readFile("main.md")).resolves.toBe("external after save started");
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(true);
    expect(ref.runtime.getState().externalConflict).toEqual({
      kind: "modified",
      path: "main.md",
    });
  });

  it("blocks saving when the active disk file disappeared", async () => {
    const fs = new MemoryFileSystem({ "main.md": "saved" });
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: "local edit",
      buffers: createDocumentMap({ "main.md": "saved" }),
      liveDocs: createDocumentMap({ "main.md": "local edit" }),
    });
    await fs.deleteFile("main.md");

    await expect(ref.result.saveCurrentDocument()).resolves.toBe(false);

    await expect(fs.exists("main.md")).resolves.toBe(false);
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(true);
    expect(ref.runtime.getState().externalConflict).toEqual({
      kind: "deleted",
      path: "main.md",
    });
  });

  it("keeps newer edits dirty when they happen during an in-flight save", async () => {
    const writeGate = createDeferred<void>();
    const writeStarted = createDeferred<void>();
    const fs = new MemoryFileSystem({ "main.md": "old" });
    const writeIfUnchanged = fs.writeFileIfUnchanged.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileIfUnchanged").mockImplementation(async (
      path,
      content,
      expectedHash,
    ) => {
      writeStarted.resolve();
      await writeGate.promise;
      return writeIfUnchanged(path, content, expectedHash);
    });
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: "first edit",
      buffers: createDocumentMap({ "main.md": "old" }),
      liveDocs: createDocumentMap({ "main.md": "first edit" }),
    });
    ref.runtime.pipeline.bumpRevision("main.md");

    const savePromise = ref.result.saveCurrentDocument();
    await writeStarted.promise;

    const newerDoc = createEditorDocumentText("second edit");
    ref.runtime.liveDocs.set("main.md", newerDoc);
    ref.runtime.pipeline.bumpRevision("main.md");
    ref.runtime.commit(
      markSessionDocumentDirty(ref.runtime.getState(), "main.md", true),
      { editorDoc: "second edit" },
    );

    writeGate.resolve();
    await expect(savePromise).resolves.toBe(false);

    expect(writeSpy).toHaveBeenCalledWith("main.md", "first edit", expect.any(String));
    await expect(fs.readFile("main.md")).resolves.toBe("first edit");
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(true);
    expect(ref.runtime.getEditorDoc()).toBe("second edit");
    expect(editorDocumentToString(ref.runtime.buffers.get("main.md") ?? emptyEditorDocument)).toBe("first edit");
    expect(editorDocumentToString(ref.runtime.liveDocs.get("main.md") ?? emptyEditorDocument)).toBe("second edit");
  });

  it("renames the active document buffers after a successful rename", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
    const onAfterPathRemoved = vi.fn();
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "hello",
      buffers: createDocumentMap({ "draft.md": "hello" }),
      liveDocs: createDocumentMap({ "draft.md": "hello" }),
      refreshTree,
      addRecentFile,
      onAfterPathRemoved,
    });

    await ref.result.handleRename("draft.md", "notes/final.md");

    await expect(fs.exists("draft.md")).resolves.toBe(false);
    await expect(fs.readFile("notes/final.md")).resolves.toBe("hello");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(addRecentFile).toHaveBeenCalledWith("notes/final.md");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "notes/final.md",
      name: "final.md",
      dirty: true,
    });
    expect(ref.runtime.getEditorDoc()).toBe("hello");
    expect(ref.runtime.buffers.has("draft.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.buffers.get("notes/final.md") ?? emptyEditorDocument)).toBe("hello");
    expect(ref.runtime.liveDocs.has("draft.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.liveDocs.get("notes/final.md") ?? emptyEditorDocument)).toBe("hello");
    expect(onAfterPathRemoved).toHaveBeenCalledWith("draft.md");
  });

  it("remaps a clean active file inside a renamed folder", async () => {
    const fs = createDirectoryRenameFileSystem({
      "notes/draft.md": "saved",
      "notes/other.md": "other",
    });
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
    const onAfterPathRemoved = vi.fn();
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "notes/draft.md",
        name: "draft.md",
        dirty: false,
      },
      editorDoc: "saved",
      buffers: createDocumentMap({ "notes/draft.md": "saved" }),
      liveDocs: createDocumentMap({ "notes/draft.md": "saved" }),
      refreshTree,
      addRecentFile,
      onAfterPathRemoved,
    });

    await ref.result.handleRename("notes", "archive");

    await expect(fs.exists("notes/draft.md")).resolves.toBe(false);
    await expect(fs.readFile("archive/draft.md")).resolves.toBe("saved");
    await expect(fs.readFile("archive/other.md")).resolves.toBe("other");
    expect(refreshTree).toHaveBeenCalledWith("archive");
    expect(addRecentFile).toHaveBeenCalledWith("archive/draft.md");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "archive/draft.md",
      name: "draft.md",
      dirty: false,
    });
    expect(ref.runtime.getEditorDoc()).toBe("saved");
    expect(ref.runtime.buffers.has("notes/draft.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.buffers.get("archive/draft.md") ?? emptyEditorDocument)).toBe("saved");
    expect(ref.runtime.liveDocs.has("notes/draft.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.liveDocs.get("archive/draft.md") ?? emptyEditorDocument)).toBe("saved");
    expect(onAfterPathRemoved).toHaveBeenCalledWith("notes/draft.md");
  });

  it("remaps and saves a dirty active file inside a renamed folder", async () => {
    const fs = createDirectoryRenameFileSystem({
      "notes/draft.md": "saved",
      "notes/other.md": "other",
    });
    const addRecentFile = vi.fn();
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "notes/draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "local edit",
      buffers: createDocumentMap({ "notes/draft.md": "saved" }),
      liveDocs: createDocumentMap({ "notes/draft.md": "local edit" }),
      addRecentFile,
    });
    ref.runtime.pipeline.bumpRevision("notes/draft.md");

    await ref.result.handleRename("notes", "archive");

    expect(addRecentFile).toHaveBeenCalledWith("archive/draft.md");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "archive/draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(ref.runtime.getEditorDoc()).toBe("local edit");
    expect(editorDocumentToString(ref.runtime.buffers.get("archive/draft.md") ?? emptyEditorDocument)).toBe("saved");
    expect(editorDocumentToString(ref.runtime.liveDocs.get("archive/draft.md") ?? emptyEditorDocument)).toBe("local edit");

    await expect(ref.result.saveCurrentDocument()).resolves.toBe(true);

    await expect(fs.exists("notes/draft.md")).resolves.toBe(false);
    await expect(fs.readFile("archive/draft.md")).resolves.toBe("local edit");
    await expect(fs.readFile("archive/other.md")).resolves.toBe("other");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "archive/draft.md",
      name: "draft.md",
      dirty: false,
    });
  });

  it("clears the current session when deleting a parent directory", async () => {
    const fs = new MemoryFileSystem({ "notes/draft.md": "hello" });
    const refreshTree = vi.fn(async () => {});
    const onAfterPathRemoved = vi.fn();
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "notes/draft.md",
        name: "draft.md",
        dirty: false,
      },
      editorDoc: "hello",
      buffers: createDocumentMap({ "notes/draft.md": "hello" }),
      liveDocs: createDocumentMap({ "notes/draft.md": "hello" }),
      refreshTree,
      onAfterPathRemoved,
    });

    await ref.result.handleDelete("notes");

    expect(sessionMockState.confirmAction).toHaveBeenCalledWith(
      "Delete \"notes\"? This cannot be undone.",
      { kind: "warning" },
    );
    await expect(fs.exists("notes/draft.md")).resolves.toBe(false);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(ref.runtime.getCurrentDocument()).toBeNull();
    expect(ref.runtime.getEditorDoc()).toBe("");
    expect(ref.runtime.buffers.has("notes/draft.md")).toBe(false);
    expect(ref.runtime.liveDocs.has("notes/draft.md")).toBe(false);
    expect(onAfterPathRemoved).toHaveBeenCalledWith("notes/draft.md");
  });

  it("cancels deleting a dirty active file when unsaved changes are canceled", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "saved" });
    const requestUnsavedChangesDecision = vi.fn<
      (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>
    >(async () => "cancel");
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "unsaved",
      buffers: createDocumentMap({ "draft.md": "saved" }),
      liveDocs: createDocumentMap({ "draft.md": "unsaved" }),
      requestUnsavedChangesDecision,
    });

    await ref.result.handleDelete("draft.md");

    expect(requestUnsavedChangesDecision).toHaveBeenCalledWith({
      reason: "delete-file",
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
      },
      target: {
        path: "draft.md",
        name: "draft.md",
      },
    });
    await expect(fs.readFile("draft.md")).resolves.toBe("saved");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(ref.runtime.getEditorDoc()).toBe("unsaved");
  });

  it("saves a dirty active file before deleting it when requested", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "saved" });
    const requestUnsavedChangesDecision = vi.fn<
      (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>
    >(async () => "save");
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "unsaved",
      buffers: createDocumentMap({ "draft.md": "saved" }),
      liveDocs: createDocumentMap({ "draft.md": "unsaved" }),
      requestUnsavedChangesDecision,
    });
    ref.runtime.pipeline.bumpRevision("draft.md");

    await ref.result.handleDelete("draft.md");

    expect(requestUnsavedChangesDecision).toHaveBeenCalledTimes(1);
    await expect(fs.exists("draft.md")).resolves.toBe(false);
    expect(ref.runtime.getCurrentDocument()).toBeNull();
    expect(ref.runtime.getEditorDoc()).toBe("");
    expect(ref.runtime.buffers.has("draft.md")).toBe(false);
    expect(ref.runtime.liveDocs.has("draft.md")).toBe(false);
  });

  it("keeps unsaved edits when discard-delete fails", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "saved" });
    vi.spyOn(fs, "deleteFile").mockRejectedValueOnce(new Error("permission denied"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const requestUnsavedChangesDecision = vi.fn<
      (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>
    >(async () => "discard");
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "unsaved",
      buffers: createDocumentMap({ "draft.md": "saved" }),
      liveDocs: createDocumentMap({ "draft.md": "unsaved" }),
      requestUnsavedChangesDecision,
    });

    try {
      await ref.result.handleDelete("draft.md");
    } finally {
      consoleError.mockRestore();
    }

    await expect(fs.readFile("draft.md")).resolves.toBe("saved");
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(ref.runtime.getEditorDoc()).toBe("unsaved");
    expect(editorDocumentToString(ref.runtime.liveDocs.get("draft.md") ?? emptyEditorDocument)).toBe("unsaved");
  });

  it("saveAs creates a missing target from the active document", async () => {
    sessionMockState.isTauri = true;
    sessionMockState.saveDialog.mockResolvedValue("/tmp/project/copy.md");
    sessionMockState.toProjectRelativePath.mockResolvedValue("copy.md");

    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const rawMain = `${header}Old chapter\n${footer}`;
    const edited = `${header}New chapter\n${footer}`;
    const fs = new MemoryFileSystem({
      "main.md": rawMain,
      "chapter.md": "Old chapter\n",
    });
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
    const onAfterPathRemoved = vi.fn();
    const onAfterSave = vi.fn();
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: edited,
      buffers: createDocumentMap({ "main.md": edited }),
      liveDocs: createDocumentMap({ "main.md": edited }),
      refreshTree,
      addRecentFile,
      onAfterPathRemoved,
      onAfterSave,
    });

    await ref.result.saveAs();

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("Old chapter\n");
    await expect(fs.readFile("copy.md")).resolves.toBe(edited);
    expect(addRecentFile).toHaveBeenCalledWith("copy.md");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(ref.runtime.getCurrentDocument()).toEqual({
      path: "copy.md",
      name: "copy.md",
      dirty: false,
    });
    expect(ref.runtime.buffers.has("main.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.buffers.get("copy.md") ?? emptyEditorDocument)).toBe(edited);
    expect(ref.runtime.liveDocs.has("main.md")).toBe(false);
    expect(editorDocumentToString(ref.runtime.liveDocs.get("copy.md") ?? emptyEditorDocument)).toBe(edited);
    expect(onAfterSave).toHaveBeenCalledWith("copy.md");
    expect(onAfterPathRemoved).toHaveBeenCalledWith("main.md");
  });
});
