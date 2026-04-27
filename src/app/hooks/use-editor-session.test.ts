import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import type { EditorDocumentChange } from "../editor-doc-change";
import { MemoryFileSystem } from "../file-manager";
import { fnv1aHash } from "../save-pipeline";
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
  renderCount: number;
}

function createHarness(
  fs: FileSystem,
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision> = async () => "discard",
  callbacks: {
    onAfterDiscard?: (path: string) => void | Promise<void>;
    onAfterPathRemoved?: (path: string) => void | Promise<void>;
    onAfterSave?: (path: string) => void | Promise<void>;
  } = {},
): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as UseEditorSessionReturn,
    renderCount: 0,
  };

  const Harness: FC = () => {
    ref.renderCount += 1;
    ref.result = useEditorSession({
      fs,
      refreshTree: async () => {},
      addRecentFile: () => {},
      onAfterDiscard: callbacks.onAfterDiscard,
      onAfterPathRemoved: callbacks.onAfterPathRemoved,
      onAfterSave: callbacks.onAfterSave,
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

function replaceCurrentDoc(
  ref: HarnessRef,
  nextDoc: string,
): readonly EditorDocumentChange[] {
  const currentDoc = ref.result.getCurrentDocText();
  return [{ from: 0, to: currentDoc.length, insert: nextDoc }];
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

  it("keeps dirty state and the active-document signal in sync while typing", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.activeDocumentSignal.getSnapshot().revision).toBeGreaterThan(0);
    expect(ref.result.currentDocument?.dirty).toBe(false);
    const initialRevision = ref.result.activeDocumentSignal.getSnapshot().revision;

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "hello!"));
    });

    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.activeDocumentSignal.getSnapshot().revision).toBe(initialRevision + 1);
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.getCurrentDocText()).toBe("hello!");
  });

  it("does not rerender the session hook on repeated edits once the document is already dirty", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    const rendersAfterOpen = ref.renderCount;

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "hello!"));
    });

    const rendersAfterFirstEdit = ref.renderCount;
    expect(rendersAfterFirstEdit).toBeGreaterThan(rendersAfterOpen);

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "hello!!"));
    });

    expect(ref.renderCount).toBe(rendersAfterFirstEdit);
    expect(ref.result.getCurrentDocText()).toBe("hello!!");
  });

  it("keeps typing on the incremental Text model until a caller explicitly needs a flat string", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    const toStringSpy = vi.spyOn(Text.prototype, "toString");

    act(() => {
      ref.result.handleDocChange([{ from: 5, to: 5, insert: "!" }]);
    });

    expect(toStringSpy).not.toHaveBeenCalled();
    expect(ref.result.getCurrentDocText()).toBe("hello!");
    expect(toStringSpy).toHaveBeenCalledTimes(1);
    toStringSpy.mockRestore();
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
  });

  it("creates the target file when saving a new in-memory document", async () => {
    const fs = new MemoryFileSystem({});
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFileWithContent("scratch.md", "# Scratch");
    });

    expect(ref.result.currentDocument?.dirty).toBe(true);

    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("scratch.md")).resolves.toBe("# Scratch");
    expect(ref.result.currentDocument?.dirty).toBe(false);
    expect(ref.result.externalConflict).toBeNull();
  });

  it("restores hot-exit recovery content as dirty even when it matches disk", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "persisted" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
      await ref.result.restoreDocumentFromRecovery("draft.md", "persisted");
    });

    expect(ref.result.getCurrentDocText()).toBe("persisted");
    expect(ref.result.currentDocument).toEqual({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });
  });

  it("restores hot-exit recovery against changed disk as an external conflict", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "external edit" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.restoreDocumentFromRecovery("draft.md", "recovered edit", {
        baselineHash: fnv1aHash("original saved"),
      });
    });

    expect(ref.result.getCurrentDocText()).toBe("recovered edit");
    expect(ref.result.currentDocument).toEqual({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });
    expect(ref.result.externalConflict).toEqual({
      kind: "modified",
      path: "draft.md",
    });

    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("external edit");
    expect(ref.result.currentDocument?.dirty).toBe(true);
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

    await act(async () => {
      reads["slow.md"].resolve("Slow");
      await openSlow;
    });

    expect(ref.result.currentPath).toBe("slow.md");
    expect(ref.result.editorDoc).toBe("Slow");
  });

  it("saves custom fenced div blocks as ordinary active-document content", async () => {
    const customBlock = [
      "::: {.custom-note}",
      "note.md",
      ":::",
    ].join("\n");
    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const rawMain = `${header}${customBlock}${footer}`;
    const edited = `${header}${customBlock}\n\nLocal note${footer}`;
    const fs = new MemoryFileSystem({
      "main.md": rawMain,
      "note.md": "Old note\n",
    });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("main.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, edited));
    });

    expect(ref.result.currentDocument?.dirty).toBe(true);

    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("main.md")).resolves.toBe(edited);
    await expect(fs.readFile("note.md")).resolves.toBe("Old note\n");
    expect(ref.result.editorDoc).toBe(edited);
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("notifies after a successful save with the saved path", async () => {
    const onAfterSave = vi.fn();
    const fs = new MemoryFileSystem({ "main.md": "# Main\n" });
    const { Harness, ref } = createHarness(
      fs,
      async () => "discard",
      { onAfterSave },
    );

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("main.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "# Main changed\n"));
    });

    await act(async () => {
      await ref.result.saveFile();
    });

    expect(onAfterSave).toHaveBeenCalledWith("main.md");
  });

  it("syncExternalChange suppresses watcher events caused by the session's own save", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "hello!"));
    });

    await act(async () => {
      await ref.result.saveFile();
    });

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("self-change");
    });
    expect(ref.result.editorDoc).toBe("hello!");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("syncExternalChange reloads a clean open document from disk", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
      await fs.writeFile("draft.md", "updated on disk");
    });

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("reloaded");
    });
    expect(ref.result.editorDoc).toBe("updated on disk");
    expect(ref.result.getCurrentDocText()).toBe("updated on disk");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("syncExternalChange asks the watcher to prompt when the current document is dirty", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
      await fs.writeFile("draft.md", "updated on disk");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local edit"));
    });

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
    });
    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.getCurrentDocText()).toBe("local edit");
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.externalConflict).toEqual({
      kind: "modified",
      path: "draft.md",
    });
    expect(ref.result.hasUnresolvedExternalConflict).toBe(true);
  });

  it("blocks saves for dirty external conflicts until the user keeps local edits", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
      await fs.writeFile("draft.md", "updated on disk");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local edit"));
    });

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
      await ref.result.saveFile();
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("updated on disk");
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.hasUnresolvedExternalConflict).toBe(true);

    await act(async () => {
      await ref.result.keepExternalConflict("draft.md");
    });

    expect(ref.result.hasUnresolvedExternalConflict).toBe(false);

    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("local edit");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("merges dirty external conflicts into a user-resolvable document", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "base\n" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
      await fs.writeFile("draft.md", "disk\n");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local\n"));
    });

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
      await ref.result.mergeExternalConflict("draft.md");
    });

    expect(ref.result.hasUnresolvedExternalConflict).toBe(false);
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.editorDoc).toBe([
      "<<<<<<< Local edits\n",
      "local\n",
      "||||||| Last saved\n",
      "base\n",
      "=======\n",
      "disk\n",
      ">>>>>>> Disk version\n",
    ].join(""));
    await expect(fs.readFile("draft.md")).resolves.toBe("disk\n");

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "resolved\n"));
    });
    await act(async () => {
      await ref.result.saveFile();
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("resolved\n");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("restores a deleted conflicted file when the user keeps local edits", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local edit"));
    });
    await fs.deleteFile("draft.md");

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
    });
    expect(ref.result.externalConflict).toEqual({
      kind: "deleted",
      path: "draft.md",
    });

    await act(async () => {
      await ref.result.keepExternalConflict("draft.md");
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("local edit");
    expect(ref.result.hasUnresolvedExternalConflict).toBe(false);
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("preserves newer edits made while restoring a deleted conflicted file", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const createGate = createDeferred<void>();
    const createFile = fs.createFile.bind(fs);
    vi.spyOn(fs, "createFile").mockImplementation(async (path, content) => {
      await createGate.promise;
      await createFile(path, content);
    });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local edit"));
    });
    await fs.deleteFile("draft.md");

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
    });

    const keepPromise = ref.result.keepExternalConflict("draft.md");
    await Promise.resolve();

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "newer edit"));
    });
    createGate.resolve();

    await act(async () => {
      await keepPromise;
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("local edit");
    expect(ref.result.getCurrentDocText()).toBe("newer edit");
    expect(ref.result.currentDocument?.dirty).toBe(true);
    expect(ref.result.hasUnresolvedExternalConflict).toBe(false);

    await act(async () => {
      await ref.result.saveFile();
    });
    await expect(fs.readFile("draft.md")).resolves.toBe("newer edit");
    expect(ref.result.currentDocument?.dirty).toBe(false);
  });

  it("converts a deleted conflict to modified when the file reappears during restore", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const createFile = fs.createFile.bind(fs);
    vi.spyOn(fs, "createFile").mockImplementation(async (path) => {
      await createFile(path, "external reappeared");
      throw new Error("File already exists");
    });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local edit"));
    });
    await fs.deleteFile("draft.md");

    await act(async () => {
      await expect(ref.result.syncExternalChange("draft.md")).resolves.toBe("notify");
      await ref.result.keepExternalConflict("draft.md");
    });

    await expect(fs.readFile("draft.md")).resolves.toBe("external reappeared");
    expect(ref.result.getCurrentDocText()).toBe("local edit");
    expect(ref.result.externalConflict).toEqual({
      kind: "modified",
      path: "draft.md",
    });
    expect(ref.result.currentDocument?.dirty).toBe(true);
  });

  it("switches files without discarding dirty inactive buffers", async () => {
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
      ref.result.handleDocChange(replaceCurrentDoc(ref, "hello!"));
    });

    await act(async () => {
      await ref.result.openFile("other.md");
    });

    expect(requestUnsavedChangesDecision).not.toHaveBeenCalled();
    expect(ref.result.currentPath).toBe("other.md");
    expect(ref.result.currentDocument?.dirty).toBe(false);

    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    expect(ref.result.currentPath).toBe("draft.md");
    expect(ref.result.editorDoc).toBe("hello!");
    expect(ref.result.currentDocument?.dirty).toBe(true);
  });

  it("does not discard dirty edits during file switch", async () => {
    const onAfterDiscard = vi.fn();
    const fs = new MemoryFileSystem({
      "draft.md": "hello",
      "other.md": "world",
    });
    const { Harness, ref } = createHarness(
      fs,
      async () => "discard",
      { onAfterDiscard },
    );

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    act(() => {
      ref.result.handleDocChange(replaceCurrentDoc(ref, "local draft"));
    });

    await act(async () => {
      await ref.result.openFile("other.md");
    });

    expect(onAfterDiscard).not.toHaveBeenCalled();
    expect(ref.result.currentPath).toBe("other.md");

    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    expect(ref.result.getCurrentDocText()).toBe("local draft");
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
