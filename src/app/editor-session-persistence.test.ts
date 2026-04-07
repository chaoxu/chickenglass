import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentText,
} from "./editor-doc-change";
import type { FileSystem } from "./file-manager";
import { MemoryFileSystem } from "./file-manager";
import { createEditorSessionState, type SessionDocument } from "./editor-session-model";
import { createEditorSessionRuntime, type EditorSessionRuntime } from "./editor-session-runtime";
import { SourceMap } from "./source-map";
import {
  createEditorSessionPersistence,
  type EditorSessionPersistence,
} from "./editor-session-persistence";

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
  sourceMaps?: Map<string, SourceMap>;
  refreshTree?: () => Promise<void>;
  addRecentFile?: (path: string) => void;
}

function createHarness({
  fs,
  currentDocument,
  editorDoc,
  buffers: initialBuffers,
  liveDocs: initialLiveDocs,
  sourceMaps: initialSourceMaps = new Map<string, SourceMap>(),
  refreshTree = async () => {},
  addRecentFile = () => {},
}: HarnessOptions): HarnessRef {
  const runtime = createEditorSessionRuntime();
  runtime.commit(createEditorSessionState(currentDocument), { editorDoc });
  for (const [path, doc] of initialBuffers) {
    runtime.buffers.set(path, doc);
  }
  for (const [path, doc] of initialLiveDocs) {
    runtime.liveDocs.set(path, doc);
  }
  for (const [path, sourceMap] of initialSourceMaps) {
    runtime.sourceMaps.set(path, sourceMap);
  }

  let result!: EditorSessionPersistence;
  runtime.setWriteDocumentSnapshot((path, content, sourceMap) =>
    result.writeDocumentSnapshot(path, content, sourceMap as SourceMap | null),
  );

  result = createEditorSessionPersistence({
    fs,
    refreshTree,
    addRecentFile,
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

describe("createEditorSessionPersistence", () => {
  beforeEach(() => {
    sessionMockState.reset();
  });

  it("saves projected include edits and clears dirty state", async () => {
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
    const ref = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: edited,
      buffers: createDocumentMap({ "main.md": expanded }),
      liveDocs: createDocumentMap({ "main.md": edited }),
      sourceMaps: new Map([["main.md", sourceMap]]),
    });

    await ref.result.saveCurrentDocument();

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("New chapter\n");
    expect(ref.runtime.getCurrentDocument()?.dirty).toBe(false);
    expect(ref.runtime.getEditorDoc()).toBe(edited);
    expect(editorDocumentToString(ref.runtime.buffers.get("main.md") ?? emptyEditorDocument)).toBe(edited);
    expect(editorDocumentToString(ref.runtime.liveDocs.get("main.md") ?? emptyEditorDocument)).toBe(edited);
  });

  it("renames the active document buffers and source map after a successful rename", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const sourceMap = new SourceMap([]);
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
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
      sourceMaps: new Map([["draft.md", sourceMap]]),
      refreshTree,
      addRecentFile,
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
    expect(ref.runtime.sourceMaps.has("draft.md")).toBe(false);
    expect(ref.runtime.sourceMaps.get("notes/final.md")).toBe(sourceMap);
  });

  it("clears the current session when deleting a parent directory", async () => {
    const fs = new MemoryFileSystem({ "notes/draft.md": "hello" });
    const refreshTree = vi.fn(async () => {});
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
  });

  it("saveAs creates a missing target and moves the source map to the new path", async () => {
    sessionMockState.isTauri = true;
    sessionMockState.saveDialog.mockResolvedValue("/tmp/project/copy.md");
    sessionMockState.toProjectRelativePath.mockResolvedValue("copy.md");

    const includeRef = [
      "::: {.include}",
      "chapter.md",
      ":::",
    ].join("\n");
    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const rawMain = `${header}${includeRef}${footer}`;
    const edited = `${header}New chapter\n${footer}`;
    const sourceMap = new SourceMap([{
      from: header.length,
      to: header.length + "New chapter\n".length,
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
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
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
      sourceMaps: new Map([["main.md", sourceMap]]),
      refreshTree,
      addRecentFile,
    });

    await ref.result.saveAs();

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("New chapter\n");
    await expect(fs.readFile("copy.md")).resolves.toBe(rawMain);
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
    expect(ref.runtime.sourceMaps.has("main.md")).toBe(false);
    expect(ref.runtime.sourceMaps.get("copy.md")).toBe(sourceMap);
  });
});
