import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileSystem } from "../file-manager";
import { basename } from "../lib/utils";
import { isTauri } from "../tauri-fs";
import { toProjectRelativePathCommand } from "../tauri-client/fs";
import { applySaveAsResult } from "../editor-session-save";
import { buildProjectedWritePlan } from "../editor-session-write-plan";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
  setCurrentSessionDocument,
} from "../editor-session-actions";
import {
  createEditorSessionState,
  getCurrentSessionDocument,
  hasSessionPath,
  type EditorSessionState,
  type SessionDocument,
} from "../editor-session-model";
import { measureAsync, withPerfOperation } from "../perf";
import type { SourceMap } from "../source-map";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";

export interface EditorSessionDeps {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

export interface UseEditorSessionReturn {
  currentDocument: SessionDocument | null;
  currentPath: string | null;
  editorDoc: string;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  buffers: React.RefObject<Map<string, string>>;
  liveDocs: React.RefObject<Map<string, string>>;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  cancelPendingOpenFile: () => void;
  handleDocChange: (doc: string) => void;
  handleProgrammaticDocChange: (path: string, doc: string) => void;
  setDocumentSourceMap: (path: string, sourceMap: SourceMap | null) => void;
  openFile: (path: string) => Promise<void>;
  openFileWithContent: (name: string, content: string) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeCurrentFile: () => Promise<boolean>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
  handleWindowCloseRequest: () => Promise<boolean>;
}

function makeTransitionRequest(
  currentDocument: SessionDocument,
  reason: UnsavedChangesRequest["reason"],
  target?: { path?: string; name: string },
): UnsavedChangesRequest {
  return {
    reason,
    currentDocument: {
      path: currentDocument.path,
      name: currentDocument.name,
    },
    target,
  };
}

function documentForPath(
  path: string | null,
  liveDocs: RefObject<Map<string, string>>,
  buffers: RefObject<Map<string, string>>,
): string {
  if (!path) return "";
  return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
}

export function useEditorSession({
  fs,
  refreshTree,
  addRecentFile,
  requestUnsavedChangesDecision,
}: EditorSessionDeps): UseEditorSessionReturn {
  const [sessionState, setSessionState] = useState<EditorSessionState>(
    () => createEditorSessionState(),
  );
  const [editorDoc, setEditorDoc] = useState("");
  const buffers = useRef<Map<string, string>>(new Map());
  const liveDocs = useRef<Map<string, string>>(new Map());
  const sourceMaps = useRef<Map<string, SourceMap>>(new Map());
  const stateRef = useRef<EditorSessionState>(sessionState);
  const openFileRequestRef = useRef(0);

  const commitSessionState = useCallback((
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

  const getSessionState = useCallback((): EditorSessionState => stateRef.current, []);

  const writeDocumentSnapshot = useCallback(async (
    targetPath: string,
    doc: string,
    sourceMap: SourceMap | null,
    options?: { createTargetIfMissing?: boolean },
  ): Promise<void> => {
    const writes = buildProjectedWritePlan(targetPath, doc, sourceMap);
    const targetExists =
      options?.createTargetIfMissing === true ? await fs.exists(targetPath) : true;

    for (const write of writes) {
      const shouldCreateTarget =
        options?.createTargetIfMissing === true &&
        write.path === targetPath &&
        !targetExists;
      await measureAsync(
        "save_file.write",
        () => (shouldCreateTarget
          ? fs.createFile(write.path, write.content)
          : fs.writeFile(write.path, write.content)),
        {
          category: "save_file",
          detail: write.path,
        },
      );
    }
  }, [fs]);

  const saveCurrentDocument = useCallback(async (): Promise<boolean> => {
    const currentPath = getSessionState().currentDocument?.path;
    if (!currentPath) return true;

    const doc = liveDocs.current.get(currentPath) ?? "";
    const sourceMap = sourceMaps.current.get(currentPath) ?? null;
    try {
      await writeDocumentSnapshot(currentPath, doc, sourceMap);
      buffers.current.set(currentPath, doc);
      liveDocs.current.set(currentPath, doc);
      commitSessionState(
        markSessionDocumentDirty(getSessionState(), currentPath, false),
        { editorDoc: doc },
      );
      return true;
    } catch (e: unknown) {
      console.error("[session] save failed:", e);
      return false;
    }
  }, [commitSessionState, getSessionState, writeDocumentSnapshot]);

  const saveFile = useCallback(async (): Promise<void> => {
    await saveCurrentDocument();
  }, [saveCurrentDocument]);

  const discardDocumentChanges = useCallback((path: string) => {
    const savedDoc = buffers.current.get(path) ?? "";
    liveDocs.current.set(path, savedDoc);
    commitSessionState(
      markSessionDocumentDirty(stateRef.current, path, false),
      stateRef.current.currentDocument?.path === path
        ? { editorDoc: savedDoc }
        : undefined,
    );
  }, [commitSessionState]);

  const prepareCurrentDocumentForTransition = useCallback(async (
    reason: UnsavedChangesRequest["reason"],
    target?: { path?: string; name: string },
  ): Promise<boolean> => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (!currentDocument || !currentDocument.dirty) {
      return true;
    }

    const decision = await requestUnsavedChangesDecision(
      makeTransitionRequest(currentDocument, reason, target),
    );

    if (decision === "cancel") {
      return false;
    }

    if (decision === "save") {
      return saveCurrentDocument();
    }

    discardDocumentChanges(currentDocument.path);
    return true;
  }, [
    discardDocumentChanges,
    requestUnsavedChangesDecision,
    saveCurrentDocument,
  ]);

  const isPathOpen = useCallback(
    (path: string): boolean => hasSessionPath(stateRef.current, path),
    [],
  );

  const isPathDirty = useCallback((path: string): boolean => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    return currentDocument?.path === path && currentDocument.dirty;
  }, []);

  const cancelPendingOpenFile = useCallback(() => {
    openFileRequestRef.current += 1;
  }, []);

  const handleDocChange = useCallback((doc: string) => {
    const currentPath = stateRef.current.currentDocument?.path;
    if (!currentPath) return;

    setEditorDoc(doc);
    liveDocs.current.set(currentPath, doc);

    const isDirty = doc !== (buffers.current.get(currentPath) ?? "");
    const nextState = markSessionDocumentDirty(stateRef.current, currentPath, isDirty);
    if (nextState !== stateRef.current) {
      commitSessionState(nextState);
    }
  }, [commitSessionState]);

  const handleProgrammaticDocChange = useCallback((path: string, doc: string) => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument?.path !== path) return;

    if (!currentDocument.dirty) {
      buffers.current.set(path, doc);
    }
    liveDocs.current.set(path, doc);
    commitSessionState(
      currentDocument.dirty
        ? stateRef.current
        : markSessionDocumentDirty(stateRef.current, path, false),
      { editorDoc: doc },
    );
  }, [commitSessionState]);

  const setDocumentSourceMap = useCallback((path: string, sourceMap: SourceMap | null) => {
    if (sourceMap) {
      sourceMaps.current.set(path, sourceMap);
      return;
    }
    sourceMaps.current.delete(path);
  }, []);

  const renameBuffers = useCallback((oldPath: string, newPath: string) => {
    const buffered = buffers.current.get(oldPath);
    if (buffered !== undefined) {
      buffers.current.delete(oldPath);
      buffers.current.set(newPath, buffered);
    }

    const liveDoc = liveDocs.current.get(oldPath);
    if (liveDoc !== undefined) {
      liveDocs.current.delete(oldPath);
      liveDocs.current.set(newPath, liveDoc);
    }

    const sourceMap = sourceMaps.current.get(oldPath);
    if (sourceMap) {
      sourceMaps.current.delete(oldPath);
      sourceMaps.current.set(newPath, sourceMap);
    }

    commitSessionState(
      renameSessionDocument(stateRef.current, oldPath, newPath, basename(newPath)),
      stateRef.current.currentDocument?.path === oldPath
        ? { editorDoc: documentForPath(newPath, liveDocs, buffers) }
        : undefined,
    );
  }, [commitSessionState]);

  const openFile = useCallback(async (path: string) => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument?.path === path) {
      addRecentFile(path);
      return;
    }

    const requestId = ++openFileRequestRef.current;
    const targetName = basename(path);
    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      path,
      name: targetName,
    });
    if (!canLeave || requestId !== openFileRequestRef.current) {
      return;
    }

    return withPerfOperation("open_file", async (operation) => {
      try {
        const content = await operation.measureAsync(
          "open_file.read",
          () => fs.readFile(path),
          { category: "open_file", detail: path },
        );

        if (requestId !== openFileRequestRef.current) {
          return;
        }

        const previousPath = stateRef.current.currentDocument?.path ?? null;
        if (previousPath && previousPath !== path) {
          buffers.current.delete(previousPath);
          liveDocs.current.delete(previousPath);
          sourceMaps.current.delete(previousPath);
        }

        sourceMaps.current.delete(path);
        buffers.current.set(path, content);
        liveDocs.current.set(path, content);
        commitSessionState(
          setCurrentSessionDocument(stateRef.current, {
            path,
            name: targetName,
            dirty: false,
          }),
          { editorDoc: content },
        );
        addRecentFile(path);
      } catch (e: unknown) {
        console.error("[session] failed to open file:", path, e);
        throw e;
      }
    }, path);
  }, [
    addRecentFile,
    commitSessionState,
    fs,
    prepareCurrentDocumentForTransition,
  ]);

  const openFileWithContent = useCallback(async (name: string, content: string) => {
    const requestId = ++openFileRequestRef.current;
    let path = name;
    let suffix = 1;
    while (hasSessionPath(stateRef.current, path)) {
      path = `${name} (${suffix++})`;
    }

    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      name: basename(path),
      path,
    });
    if (!canLeave || requestId !== openFileRequestRef.current) return;

    const previousPath = stateRef.current.currentDocument?.path ?? null;
    if (previousPath && previousPath !== path) {
      buffers.current.delete(previousPath);
      liveDocs.current.delete(previousPath);
      sourceMaps.current.delete(previousPath);
    }

    sourceMaps.current.delete(path);
    buffers.current.set(path, "");
    liveDocs.current.set(path, content);
    commitSessionState(
      setCurrentSessionDocument(stateRef.current, {
        path,
        name: basename(path),
        dirty: true,
      }),
      { editorDoc: content },
    );
  }, [commitSessionState, prepareCurrentDocumentForTransition]);

  const reloadFile = useCallback(async (path: string) => {
    if (!hasSessionPath(stateRef.current, path)) return;

    try {
      const content = await fs.readFile(path);
      sourceMaps.current.delete(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);
      commitSessionState(
        markSessionDocumentDirty(stateRef.current, path, false),
        stateRef.current.currentDocument?.path === path
          ? { editorDoc: content }
          : undefined,
      );
    } catch (e: unknown) {
      console.error("[session] reload failed:", path, e);
      throw e;
    }
  }, [commitSessionState, fs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await refreshTree();
      await openFile(path);
    } catch (e: unknown) {
      console.error("[session] create file failed:", e);
    }
  }, [fs, openFile, refreshTree]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory",
        detail: path,
      });
      await refreshTree();
    } catch (e: unknown) {
      console.error("[session] create directory failed:", e);
    }
  }, [fs, refreshTree]);

  const closeCurrentFile = useCallback(async (): Promise<boolean> => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (!currentDocument) return true;

    const canClose = await prepareCurrentDocumentForTransition("close-file");
    if (!canClose) return false;

    buffers.current.delete(currentDocument.path);
    liveDocs.current.delete(currentDocument.path);
    sourceMaps.current.delete(currentDocument.path);
    commitSessionState(
      clearSessionDocument(stateRef.current, currentDocument.path),
      { editorDoc: "" },
    );
    return true;
  }, [commitSessionState, prepareCurrentDocumentForTransition]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
      addRecentFile(newPath);
    } catch (e: unknown) {
      console.error("[session] rename failed:", e);
    }
  }, [addRecentFile, fs, refreshTree, renameBuffers]);

  const handleDelete = useCallback(async (path: string) => {
    const ok = window.confirm(`Delete "${basename(path)}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file",
        detail: path,
      });
    } catch (e: unknown) {
      console.error("[session] delete failed:", e);
      return;
    }

    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument && (currentDocument.path === path || currentDocument.path.startsWith(`${path}/`))) {
      buffers.current.delete(currentDocument.path);
      liveDocs.current.delete(currentDocument.path);
      sourceMaps.current.delete(currentDocument.path);
      commitSessionState(
        clearSessionDocument(stateRef.current, currentDocument.path),
        { editorDoc: "" },
      );
    }

    await refreshTree();
  }, [commitSessionState, fs, refreshTree]);

  const saveAs = useCallback(async () => {
    const currentPath = getSessionState().currentDocument?.path;
    if (!currentPath) return;
    const doc = liveDocs.current.get(currentPath) ?? "";
    const sourceMap = sourceMaps.current.get(currentPath) ?? null;

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: currentPath,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!savePath) return;

        const relativePath = await toProjectRelativePathCommand(savePath);
        await writeDocumentSnapshot(relativePath, doc, sourceMap, {
          createTargetIfMissing: true,
        });

        if (sourceMap && currentPath !== relativePath) {
          sourceMaps.current.delete(currentPath);
          sourceMaps.current.set(relativePath, sourceMap);
        }

        commitSessionState(
          applySaveAsResult({
            state: getSessionState(),
            buffers: buffers.current,
            liveDocs: liveDocs.current,
            oldPath: currentPath,
            newPath: relativePath,
            doc,
          }),
          { editorDoc: doc },
        );
        addRecentFile(relativePath);
        await refreshTree();
      } catch (e: unknown) {
        console.error("[session] save-as failed:", e);
        throw e;
      }
      return;
    }

    const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = basename(currentPath);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [addRecentFile, commitSessionState, getSessionState, refreshTree, writeDocumentSnapshot]);

  const handleWindowCloseRequest = useCallback(async (): Promise<boolean> => {
    return prepareCurrentDocumentForTransition("close-window");
  }, [prepareCurrentDocumentForTransition]);

  return {
    currentDocument: sessionState.currentDocument,
    currentPath: sessionState.currentDocument?.path ?? null,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    isPathOpen,
    isPathDirty,
    cancelPendingOpenFile,
    handleDocChange,
    handleProgrammaticDocChange,
    setDocumentSourceMap,
    openFile,
    openFileWithContent,
    reloadFile,
    saveFile,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleRename,
    handleDelete,
    saveAs,
    handleWindowCloseRequest,
  };
}
