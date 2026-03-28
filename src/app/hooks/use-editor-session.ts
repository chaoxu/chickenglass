import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileSystem } from "../file-manager";
import { basename } from "../lib/utils";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
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
import { SavePipeline } from "../save-pipeline";
import type { SourceMap } from "../source-map";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";
import { useEditorSessionPersistence } from "./use-editor-session-persistence";

export interface EditorSessionDeps {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: () => void;
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
  pipeline: SavePipeline;
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
  closeCurrentFile: (options?: { discard?: boolean }) => Promise<boolean>;
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
  refreshGitStatus,
  addRecentFile,
  onAfterSave,
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
  const writeDocumentSnapshotRef = useRef<
    (path: string, content: string, sourceMap: unknown) => Promise<string>
  >(async () => "");

  const pipeline = useMemo(() => new SavePipeline(
    (path, content, sourceMap) => writeDocumentSnapshotRef.current(path, content, sourceMap),
  ), []);

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
  const {
    saveCurrentDocument,
    saveFile,
    handleRename,
    handleDelete,
    saveAs,
    writeDocumentSnapshot,
  } = useEditorSessionPersistence({
    fs,
    pipeline,
    refreshTree,
    addRecentFile,
    onAfterSave,
    buffers,
    liveDocs,
    sourceMaps,
    stateRef,
    commitSessionState,
    getSessionState,
  });

  writeDocumentSnapshotRef.current = (path, content, sourceMap) =>
    writeDocumentSnapshot(path, content, sourceMap as SourceMap | null);

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
      const saved = await saveCurrentDocument();
      if (saved) void refreshGitStatus();
      return saved;
    }

    discardDocumentChanges(currentDocument.path);
    return true;
  }, [
    discardDocumentChanges,
    refreshGitStatus,
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
    pipeline.bumpRevision(currentPath);

    const isDirty = doc !== (buffers.current.get(currentPath) ?? "");
    const nextState = markSessionDocumentDirty(stateRef.current, currentPath, isDirty);
    if (nextState !== stateRef.current) {
      commitSessionState(nextState);
    }
  }, [commitSessionState, pipeline]);

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
          pipeline.clear(previousPath);
          buffers.current.delete(previousPath);
          liveDocs.current.delete(previousPath);
          sourceMaps.current.delete(previousPath);
        }

        sourceMaps.current.delete(path);
        buffers.current.set(path, content);
        liveDocs.current.set(path, content);
        pipeline.initPath(path, content);
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
    pipeline,
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
      pipeline.clear(previousPath);
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
  }, [commitSessionState, pipeline, prepareCurrentDocumentForTransition]);

  const reloadFile = useCallback(async (path: string) => {
    if (!hasSessionPath(stateRef.current, path)) return;

    try {
      const content = await fs.readFile(path);
      sourceMaps.current.delete(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);
      pipeline.initPath(path, content);
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
  }, [commitSessionState, fs, pipeline]);

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

  const closeCurrentFile = useCallback(async (
    options?: { discard?: boolean },
  ): Promise<boolean> => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (!currentDocument) return true;

    if (!options?.discard) {
      const canClose = await prepareCurrentDocumentForTransition("close-file");
      if (!canClose) return false;
    }

    pipeline.clear(currentDocument.path);
    buffers.current.delete(currentDocument.path);
    liveDocs.current.delete(currentDocument.path);
    sourceMaps.current.delete(currentDocument.path);
    commitSessionState(
      clearSessionDocument(stateRef.current, currentDocument.path),
      { editorDoc: "" },
    );
    return true;
  }, [commitSessionState, pipeline, prepareCurrentDocumentForTransition]);

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
    pipeline,
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
