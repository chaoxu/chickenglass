import * as React from "react";
import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import { MemoryFileSystem } from "../file-manager";
import { createEditorSessionState, type EditorSessionState, type SessionDocument } from "../editor-session-model";
import { SourceMap } from "../source-map";

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

const { SavePipeline } = await import("../save-pipeline");
const { useEditorSessionPersistence } = await import("./use-editor-session-persistence");

interface HarnessRef {
  result: ReturnType<typeof useEditorSessionPersistence>;
  sessionState: EditorSessionState;
  editorDoc: string;
  buffers: React.RefObject<Map<string, string>>;
  liveDocs: React.RefObject<Map<string, string>>;
  sourceMaps: React.RefObject<Map<string, SourceMap>>;
}

interface HarnessOptions {
  fs: FileSystem;
  currentDocument: SessionDocument | null;
  editorDoc: string;
  buffers: Map<string, string>;
  liveDocs: Map<string, string>;
  sourceMaps?: Map<string, SourceMap>;
  refreshTree?: () => Promise<void>;
  addRecentFile?: (path: string) => void;
}

function documentForPath(
  path: string | null,
  liveDocs: React.RefObject<Map<string, string>>,
  buffers: React.RefObject<Map<string, string>>,
): string {
  if (!path) return "";
  return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
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
}: HarnessOptions): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as ReturnType<typeof useEditorSessionPersistence>,
    sessionState: createEditorSessionState(currentDocument),
    editorDoc,
    buffers: null as unknown as React.RefObject<Map<string, string>>,
    liveDocs: null as unknown as React.RefObject<Map<string, string>>,
    sourceMaps: null as unknown as React.RefObject<Map<string, SourceMap>>,
  };

  const Harness: FC = () => {
    const [sessionState, setSessionState] = React.useState<EditorSessionState>(() =>
      createEditorSessionState(currentDocument),
    );
    const [currentEditorDoc, setEditorDoc] = React.useState(editorDoc);
    const buffers = React.useRef(new Map(initialBuffers));
    const liveDocs = React.useRef(new Map(initialLiveDocs));
    const sourceMaps = React.useRef(new Map(initialSourceMaps));
    const stateRef = React.useRef(sessionState);

    const commitSessionState = React.useCallback((
      nextState: EditorSessionState,
      options?: {
        editorDoc?: string;
        syncEditorDoc?: boolean;
      },
    ) => {
      stateRef.current = nextState;
      setSessionState(nextState);

      if (Object.prototype.hasOwnProperty.call(options ?? {}, "editorDoc")) {
        setEditorDoc(options?.editorDoc ?? "");
        return;
      }

      if (options?.syncEditorDoc) {
        setEditorDoc(documentForPath(nextState.currentDocument?.path ?? null, liveDocs, buffers));
      }
    }, []);

    const getSessionState = React.useCallback(() => stateRef.current, []);

    const writeRef = React.useRef<
      (path: string, content: string, sourceMap: unknown) => Promise<string>
    >(async () => "");
    const pipeline = React.useMemo(() => new SavePipeline(
      (path, content, sourceMap) => writeRef.current(path, content, sourceMap),
    ), []);

    const hookResult = useEditorSessionPersistence({
      fs,
      pipeline,
      refreshTree,
      addRecentFile,
      buffers,
      liveDocs,
      sourceMaps,
      stateRef,
      commitSessionState,
      getSessionState,
    });
    writeRef.current = (path, content, sourceMap) =>
      hookResult.writeDocumentSnapshot(
        path, content, sourceMap as SourceMap | null,
      );
    ref.result = hookResult;
    ref.sessionState = sessionState;
    ref.editorDoc = currentEditorDoc;
    ref.buffers = buffers;
    ref.liveDocs = liveDocs;
    ref.sourceMaps = sourceMaps;
    return null;
  };

  return { Harness, ref };
}

describe("useEditorSessionPersistence", () => {
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
    const { Harness, ref } = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: edited,
      buffers: new Map([["main.md", expanded]]),
      liveDocs: new Map([["main.md", edited]]),
      sourceMaps: new Map([["main.md", sourceMap]]),
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.saveCurrentDocument();
    });

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("New chapter\n");
    expect(ref.sessionState.currentDocument?.dirty).toBe(false);
    expect(ref.editorDoc).toBe(edited);
    expect(ref.buffers.current.get("main.md")).toBe(edited);
    expect(ref.liveDocs.current.get("main.md")).toBe(edited);
  });

  it("renames the active document buffers and source map after a successful rename", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const sourceMap = new SourceMap([]);
    const refreshTree = vi.fn(async () => {});
    const addRecentFile = vi.fn();
    const { Harness, ref } = createHarness({
      fs,
      currentDocument: {
        path: "draft.md",
        name: "draft.md",
        dirty: true,
      },
      editorDoc: "hello",
      buffers: new Map([["draft.md", "hello"]]),
      liveDocs: new Map([["draft.md", "hello"]]),
      sourceMaps: new Map([["draft.md", sourceMap]]),
      refreshTree,
      addRecentFile,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.handleRename("draft.md", "notes/final.md");
    });

    await expect(fs.exists("draft.md")).resolves.toBe(false);
    await expect(fs.readFile("notes/final.md")).resolves.toBe("hello");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(addRecentFile).toHaveBeenCalledWith("notes/final.md");
    expect(ref.sessionState.currentDocument).toEqual({
      path: "notes/final.md",
      name: "final.md",
      dirty: true,
    });
    expect(ref.editorDoc).toBe("hello");
    expect(ref.buffers.current.has("draft.md")).toBe(false);
    expect(ref.buffers.current.get("notes/final.md")).toBe("hello");
    expect(ref.liveDocs.current.has("draft.md")).toBe(false);
    expect(ref.liveDocs.current.get("notes/final.md")).toBe("hello");
    expect(ref.sourceMaps.current.has("draft.md")).toBe(false);
    expect(ref.sourceMaps.current.get("notes/final.md")).toBe(sourceMap);
  });

  it("clears the current session when deleting a parent directory", async () => {
    const fs = new MemoryFileSystem({ "notes/draft.md": "hello" });
    const refreshTree = vi.fn(async () => {});
    const { Harness, ref } = createHarness({
      fs,
      currentDocument: {
        path: "notes/draft.md",
        name: "draft.md",
        dirty: false,
      },
      editorDoc: "hello",
      buffers: new Map([["notes/draft.md", "hello"]]),
      liveDocs: new Map([["notes/draft.md", "hello"]]),
      refreshTree,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.handleDelete("notes");
    });

    expect(sessionMockState.confirmAction).toHaveBeenCalledWith(
      "Delete \"notes\"? This cannot be undone.",
      { kind: "warning" },
    );
    await expect(fs.exists("notes/draft.md")).resolves.toBe(false);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(ref.sessionState.currentDocument).toBeNull();
    expect(ref.editorDoc).toBe("");
    expect(ref.buffers.current.has("notes/draft.md")).toBe(false);
    expect(ref.liveDocs.current.has("notes/draft.md")).toBe(false);
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
    const { Harness, ref } = createHarness({
      fs,
      currentDocument: {
        path: "main.md",
        name: "main.md",
        dirty: true,
      },
      editorDoc: edited,
      buffers: new Map([["main.md", edited]]),
      liveDocs: new Map([["main.md", edited]]),
      sourceMaps: new Map([["main.md", sourceMap]]),
      refreshTree,
      addRecentFile,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.saveAs();
    });

    await expect(fs.readFile("main.md")).resolves.toBe(rawMain);
    await expect(fs.readFile("chapter.md")).resolves.toBe("New chapter\n");
    await expect(fs.readFile("copy.md")).resolves.toBe(rawMain);
    expect(addRecentFile).toHaveBeenCalledWith("copy.md");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(ref.sessionState.currentDocument).toEqual({
      path: "copy.md",
      name: "copy.md",
      dirty: false,
    });
    expect(ref.buffers.current.has("main.md")).toBe(false);
    expect(ref.buffers.current.get("copy.md")).toBe(edited);
    expect(ref.liveDocs.current.has("main.md")).toBe(false);
    expect(ref.liveDocs.current.get("copy.md")).toBe(edited);
    expect(ref.sourceMaps.current.has("main.md")).toBe(false);
    expect(ref.sourceMaps.current.get("copy.md")).toBe(sourceMap);
  });
});
